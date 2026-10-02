-- ============================================================================
-- (1) register_manual_partial_payment ganha `p_received_at` opcional
-- ============================================================================
--
-- Pedido explícito do usuário, 06/09/2026: ao confirmar um recebimento
-- (total ou parcial), o prestador deve poder escolher em que dia o dinheiro
-- efetivamente entrou (padrão: hoje, ajuste manual via `DatePickerField` já
-- existente) — isso é o que define em qual mês o valor aparece no histórico
-- financeiro mensal (`get_financial_monthly_history`, DEC-166, agrupa
-- `receivedTotalCents` por `received_at`). Antes desta migration, a função
-- gravava sempre `now()` no `receipt` e na cobrança-pai quitada, sem opção de
-- escolha.
--
-- `p_received_at` é adicionado com `default null` ao FINAL da lista de
-- parâmetros (mesmo padrão de evolução de assinatura já usado neste projeto
-- — ver `update_appointment`/`create_appointment`): muda a identidade da
-- função (tipos de argumento), por isso o `drop function` explícito do
-- 2-arg antigo antes do `create or replace` do novo, mesmo padrão de
-- 20260818120000/20260813130000. Omitido (`null`), o comportamento é
-- idêntico ao anterior (`now()`).
drop function if exists public.register_manual_partial_payment(uuid, integer);

create or replace function public.register_manual_partial_payment(
  p_id uuid,
  p_amount_cents integer,
  p_received_at timestamptz default null
)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_current public.manual_payments;
  v_receipt public.manual_payments;
  v_received_before integer;
  v_balance integer;
  v_new_status text;
  v_received_at timestamptz := coalesce(p_received_at, now());
begin
  if p_amount_cents <= 0 then raise exception 'PAYMENT_VALUE_INVALID: amount must be greater than zero' using errcode='22023'; end if;
  select * into v_current from public.manual_payments where id=p_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND: payment not found' using errcode='P0002'; end if;
  if v_current.kind <> 'charge' or v_current.status='cancelled' then
    raise exception 'PAYMENT_CANCELLED: payment was cancelled and cannot receive a partial payment' using errcode='22023';
  end if;
  if v_current.status='received' then
    raise exception 'PAYMENT_ALREADY_SETTLED: payment is already settled or not eligible for partial payment' using errcode='22023';
  end if;

  -- Saldo derivado (nunca mais lido direto de `value_cents`, que agora é
  -- sempre o total original e imutável por este fluxo).
  select coalesce(sum(value_cents), 0) into v_received_before
    from public.manual_payments
    where parent_payment_id = p_id and kind = 'receipt' and status = 'received';

  v_balance := v_current.value_cents - v_received_before;
  if v_balance <= 0 then
    raise exception 'PAYMENT_ALREADY_SETTLED: payment is already settled or not eligible for partial payment' using errcode='22023';
  end if;
  if p_amount_cents > v_balance then raise exception 'PAYMENT_EXCEEDS_BALANCE: amount exceeds pending balance' using errcode='22023'; end if;

  -- Mesma regra de transição de status do design antigo (preservada por
  -- compatibilidade): uma quitação parcial que não fecha o total sempre leva
  -- a cobrança para `pending`, mesmo que estivesse `overdue` — recebeu
  -- dinheiro, deixa de fazer sentido continuar marcada como atrasada por
  -- inteiro.
  v_new_status := case when v_received_before + p_amount_cents >= v_current.value_cents then 'received' else 'pending' end;

  update public.manual_payments
    set status = v_new_status,
        received_at = case when v_new_status = 'received' then v_received_at else null end,
        updated_at = now()
    where id = p_id
    returning * into v_current;

  insert into public.manual_payments(tenant_id,client_id,origin,value_cents,due_date,status,notes,kind,parent_payment_id,received_at)
    values(v_current.tenant_id,v_current.client_id,'Valor quitado — '||v_current.origin,p_amount_cents,current_date,'received',v_current.notes,'receipt',v_current.id,v_received_at)
    returning * into v_receipt;

  -- Chave `pending` mantida por compatibilidade de contrato com o adapter
  -- (`RegisterPartialPaymentResult.pending`): sempre a linha da cobrança
  -- atualizada, independentemente do status final ser `pending` ou
  -- `received`.
  return jsonb_build_object('pending', to_jsonb(v_current), 'receipt', to_jsonb(v_receipt));
end $$;

revoke all on function public.register_manual_partial_payment(uuid,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.register_manual_partial_payment(uuid,integer,timestamptz) to authenticated;

-- ============================================================================
-- (2) get_manual_payment_history — corrige "Recebido" na tabela x "A receber"
--     no detalhe
-- ============================================================================
--
-- BUG encontrado (relato do usuário, 06/09/2026): "alguns recebidos estão OK
-- na tabela principal, só que ao abrir a tela de detalhe do pagamento
-- aparece 'a receber'". Causa raiz: `receivedCents`/`balanceCents` sempre
-- foram derivados só da soma dos `receipt` filhos (`kind='receipt'`) — mas o
-- fluxo de "Recebimento total" (`updatePayment(id, {status:'received'})`,
-- usado tanto pelo modal dedicado de recebimento quanto pela edição manual
-- de status) muda o status da própria cobrança para `received` SEM nunca
-- inserir um `receipt` filho. Resultado: a cobrança aparece corretamente
-- como "Recebido" na tabela (`list_manual_payments`, que lê o `status` da
-- própria linha), mas o detalhe calculava `receivedCents = 0` /
-- `balanceCents = value_cents` (valor total, como se nada tivesse sido
-- recebido).
--
-- A mesma regra já existe, documentada e aplicada, em `list_manual_payments`
-- e no dashboard (`get_provider_dashboard_snapshot`): "recebido = soma(
-- recibos `received`) + soma(cobranças `received` SEM nenhum recibo
-- filho)". Esta migration só estende a mesma regra, que faltava aqui:
-- sempre que a cobrança em si está `received`, ela conta pelo seu total
-- original — nunca 0 —, independentemente de ter ou não `receipt` filhos.
create or replace function public.get_manual_payment_history(p_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_charge public.manual_payments;
  v_client_name text;
  v_received_cents integer;
  v_receipts jsonb;
begin
  select * into v_charge from public.manual_payments where id = p_id and kind = 'charge';
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: payment not found' using errcode='P0002';
  end if;

  select name into v_client_name from public.clients where id = v_charge.client_id;

  if v_charge.status = 'received' then
    v_received_cents := v_charge.value_cents;
  else
    select coalesce(sum(value_cents), 0) into v_received_cents
      from public.manual_payments
      where parent_payment_id = p_id and kind = 'receipt' and status = 'received';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    into v_receipts
    from public.manual_payments r
    where r.parent_payment_id = p_id and r.kind = 'receipt';

  return jsonb_build_object(
    'charge', to_jsonb(v_charge) || jsonb_build_object('client_name', v_client_name),
    'receivedCents', v_received_cents,
    'balanceCents', greatest(v_charge.value_cents - v_received_cents, 0),
    'receipts', v_receipts
  );
end $$;

revoke all on function public.get_manual_payment_history(uuid) from public, anon, authenticated;
grant execute on function public.get_manual_payment_history(uuid) to authenticated;
