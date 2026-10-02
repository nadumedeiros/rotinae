-- ============================================================================
-- Histórico de pagamento parcial: cobrança principal deixa de ser mutada
-- ============================================================================
--
-- PROBLEMA (achado de produto, tela `app/payments.tsx`):
-- `register_manual_partial_payment` (20260811120000) decrementa
-- `value_cents` da própria cobrança (`kind='charge'`) a cada pagamento
-- parcial registrado. Consequência prática: o "valor total" de uma cobrança
-- de R$ 1.000 com um parcial de R$ 300 já registrado passa a exibir
-- R$ 700,00 na tabela principal — o total original de R$ 1.000 não fica
-- preservado em lugar nenhum depois da primeira quitação parcial. Além
-- disso, `list_manual_payments` não filtra por `kind`, então o `receipt`
-- (linha filha inserida pela RPC) aparece como uma segunda linha na tabela
-- principal, ao lado da cobrança que o originou.
--
-- DECISÃO DE ARQUITETURA (não reaberta em revisões futuras sem novo achado):
-- `value_cents` de uma linha `kind='charge'` passa a representar sempre o
-- TOTAL ORIGINAL da cobrança, imutável por pagamentos parciais (só editável
-- pelo usuário via edição manual da cobrança, como já era antes). O
-- "recebido"/"saldo restante" de uma cobrança específica passa a ser sempre
-- DERIVADO, nunca armazenado na própria linha:
--   recebido_da_cobranca = soma(value_cents dos `receipt` filhos com
--                                status = 'received')
--   saldo_da_cobranca    = value_cents (total) - recebido_da_cobranca
-- A cobrança só muda para `status = 'received'` quando
-- `recebido_da_cobranca >= value_cents` (quitação total, exata ou por soma
-- de parciais). `list_manual_payments` passa a listar/paginar somente
-- `kind = 'charge'` na tabela principal — os `receipt` ficam disponíveis
-- apenas através do histórico de cada cobrança (`get_manual_payment_history`,
-- criada nesta migration).
--
-- Nunca editamos migrations antigas — todas as funções abaixo são
-- redefinidas por completo via `create or replace` nesta migration nova,
-- mesmo padrão do restante do projeto (ex.: 20260819100000).
-- ============================================================================


-- ============================================================================
-- 0) BACKFILL — reconstrói o total original de cobranças já parcialmente
--    quitadas sob o design antigo (produção confirmada com 3 linhas nesta
--    condição em 2026-08-23: `866ccfa8`/`b3d61140`/`c2ab8c0f`, todas ainda
--    `status = 'pending'`). Escrito de forma defensiva porque PRECISA rodar
--    mesmo em ambientes com zero linhas afetadas (ex.: banco novo).
-- ============================================================================
--
-- Deve rodar ANTES da redefinição de `register_manual_partial_payment`
-- abaixo: a partir desta migration, a RPC para de decrementar `value_cents`
-- da cobrança — sem este backfill, as cobranças já afetadas pelo
-- comportamento antigo ficariam com o total errado (o valor já decrementado)
-- para sempre, já que passariam a não ser mais corrigidas automaticamente
-- por nenhum outro fluxo.
update public.manual_payments c
set value_cents = c.value_cents + r.receipts_sum,
    updated_at = now()
from (
  select parent_payment_id, sum(value_cents) as receipts_sum
  from public.manual_payments
  where kind = 'receipt'
  group by parent_payment_id
) r
where c.id = r.parent_payment_id
  and c.kind = 'charge';

-- Verificação de pós-condição do backfill: nenhuma cobrança pode ficar com
-- total menor que a soma dos seus próprios recibos — se isso acontecer, o
-- backfill acima está incompleto ou incorreto, e a migration inteira deve
-- falhar (transação abortada) em vez de publicar dado financeiro incoerente.
do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count
  from public.manual_payments c
  where c.kind = 'charge'
    and c.value_cents < coalesce((
      select sum(r.value_cents)
      from public.manual_payments r
      where r.parent_payment_id = c.id and r.kind = 'receipt'
    ), 0);

  assert v_bad_count = 0,
    'manual_payments_receipt_history: existe cobranca cujo total é menor que a soma de seus recibos (backfill incompleto)';

  -- Toda cobrança já quitada por soma de recibos deveria já estar como
  -- `received` (invariante herdada do comportamento antigo: a RPC anterior
  -- só zerava `value_cents` e marcava `received` exatamente quando a soma
  -- batia com o total). Se isso não for verdade, o dado de produção diverge
  -- do que a auditoria assume e a migration deve falhar para investigação.
  select count(*) into v_bad_count
  from public.manual_payments c
  where c.kind = 'charge'
    and c.status not in ('received', 'cancelled')
    and c.value_cents > 0
    and coalesce((
      select sum(r.value_cents)
      from public.manual_payments r
      where r.parent_payment_id = c.id and r.kind = 'receipt' and r.status = 'received'
    ), 0) >= c.value_cents;

  assert v_bad_count = 0,
    'manual_payments_receipt_history: existe cobranca totalmente quitada por recibos com status diferente de received';

  raise notice 'manual_payments_receipt_history: backfill validado, nenhuma inconsistência encontrada.';
end $$;


-- ============================================================================
-- 1) register_manual_partial_payment — para de decrementar o total do pai
-- ============================================================================
--
-- Mantidas TODAS as validações já existentes (kind, cancelado, já quitado,
-- excede saldo) — ver comentário extenso original em 20260811120000 sobre a
-- escolha de `security invoker` (continua válida sem alteração: todas as
-- operações permanecem dentro de linhas do próprio tenant do chamador, já
-- cobertas por `manual_payments_owner_all`).
--
-- MUDANÇA: `v_current.value_cents` (o total da cobrança) nunca mais é escrito
-- pela RPC. O saldo pendente passa a ser calculado a partir da soma dos
-- `receipt` já `received` deste pai; a cobrança só muda de status quando essa
-- soma (incluindo o novo valor recebido agora) atinge ou ultrapassa o total.
create or replace function public.register_manual_partial_payment(p_id uuid, p_amount_cents integer)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_current public.manual_payments;
  v_receipt public.manual_payments;
  v_received_before integer;
  v_balance integer;
  v_new_status text;
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
        received_at = case when v_new_status = 'received' then now() else null end,
        updated_at = now()
    where id = p_id
    returning * into v_current;

  insert into public.manual_payments(tenant_id,client_id,origin,value_cents,due_date,status,notes,kind,parent_payment_id,received_at)
    values(v_current.tenant_id,v_current.client_id,'Valor quitado — '||v_current.origin,p_amount_cents,current_date,'received',v_current.notes,'receipt',v_current.id,now())
    returning * into v_receipt;

  -- Chave `pending` mantida por compatibilidade de contrato com o adapter
  -- (`RegisterPartialPaymentResult.pending`): sempre a linha da cobrança
  -- atualizada, independentemente do status final ser `pending` ou
  -- `received`.
  return jsonb_build_object('pending', to_jsonb(v_current), 'receipt', to_jsonb(v_receipt));
end $$;

revoke all on function public.register_manual_partial_payment(uuid,integer) from public, anon, authenticated;
grant execute on function public.register_manual_partial_payment(uuid,integer) to authenticated;


-- ============================================================================
-- 2) update_manual_payment_receipt — editar um pagamento parcial já
--    registrado (NOVA)
-- ============================================================================
--
-- Opera SOMENTE sobre linhas `kind = 'receipt'`. `security invoker`: mesmo
-- raciocínio de `register_manual_partial_payment` — receipt e seu pai
-- sempre pertencem ao mesmo tenant, já coberto por `manual_payments_owner_all`
-- (`for all`), sem necessidade de atravessar RLS.
--
-- `p_due_date`/`p_notes` nulos significam "não alterar" (mesma convenção de
-- `UpdatePaymentInput` no frontend — `undefined` no adapter vira `null` no
-- parâmetro e o campo correspondente não é tocado). Para limpar
-- explicitamente `notes`, o chamador deve enviar string vazia, nunca null.
create or replace function public.update_manual_payment_receipt(
  p_id uuid,
  p_amount_cents integer,
  p_due_date date default null,
  p_notes text default null
)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_receipt public.manual_payments;
  v_parent public.manual_payments;
  v_other_received integer;
  v_new_status text;
begin
  if p_amount_cents <= 0 then
    raise exception 'PAYMENT_VALUE_INVALID: amount must be greater than zero' using errcode='22023';
  end if;

  select * into v_receipt from public.manual_payments where id = p_id for update;
  if not found or v_receipt.kind <> 'receipt' then
    raise exception 'PAYMENT_NOT_FOUND: receipt not found' using errcode='P0002';
  end if;

  select * into v_parent from public.manual_payments where id = v_receipt.parent_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: parent payment not found' using errcode='P0002';
  end if;

  -- Uma cobrança cancelada é um estado terminal (mesmo princípio de
  -- PAYMENT_CANCELLED em `register_manual_partial_payment`): nenhum recibo
  -- já associado a ela pode ser editado, para não reabrir silenciosamente um
  -- registro morto.
  if v_parent.status = 'cancelled' then
    raise exception 'PAYMENT_CANCELLED: parent payment was cancelled and its receipts can no longer be edited' using errcode='22023';
  end if;

  select coalesce(sum(value_cents), 0) into v_other_received
    from public.manual_payments
    where parent_payment_id = v_parent.id and kind = 'receipt' and status = 'received' and id <> p_id;

  if p_amount_cents > (v_parent.value_cents - v_other_received) then
    raise exception 'PAYMENT_EXCEEDS_BALANCE: amount exceeds pending balance' using errcode='22023';
  end if;

  update public.manual_payments
    set value_cents = p_amount_cents,
        due_date = coalesce(p_due_date, due_date),
        notes = case when p_notes is not null then p_notes else notes end,
        updated_at = now()
    where id = p_id
    returning * into v_receipt;

  -- Recomputa o status do pai: pode voltar de `received` para `pending`/
  -- `overdue` se a edição reduzir a soma dos recibos abaixo do total.
  v_new_status := case
    when v_other_received + p_amount_cents >= v_parent.value_cents then 'received'
    when v_parent.due_date < current_date then 'overdue'
    else 'pending'
  end;

  update public.manual_payments
    set status = v_new_status,
        received_at = case when v_new_status = 'received' then now() else null end,
        updated_at = now()
    where id = v_parent.id
    returning * into v_parent;

  return jsonb_build_object('receipt', to_jsonb(v_receipt), 'parent', to_jsonb(v_parent));
end $$;

revoke all on function public.update_manual_payment_receipt(uuid,integer,date,text) from public, anon, authenticated;
grant execute on function public.update_manual_payment_receipt(uuid,integer,date,text) to authenticated;


-- ============================================================================
-- 3) delete_manual_payment_receipt — excluir um pagamento parcial já
--    registrado (NOVA)
-- ============================================================================
--
-- Diferente de `deletePayment` sobre uma `charge` (bloqueada pela FK
-- `manual_payments_parent_payment_fk ... on delete restrict` quando há
-- recibos filhos), excluir um `receipt` nunca viola essa FK — ele é o lado
-- filho da relação. Recompõe o status do pai depois da exclusão.
create or replace function public.delete_manual_payment_receipt(p_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_receipt public.manual_payments;
  v_parent public.manual_payments;
  v_remaining_received integer;
  v_new_status text;
begin
  select * into v_receipt from public.manual_payments where id = p_id for update;
  if not found or v_receipt.kind <> 'receipt' then
    raise exception 'PAYMENT_NOT_FOUND: receipt not found' using errcode='P0002';
  end if;

  select * into v_parent from public.manual_payments where id = v_receipt.parent_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND: parent payment not found' using errcode='P0002';
  end if;

  if v_parent.status = 'cancelled' then
    raise exception 'PAYMENT_CANCELLED: parent payment was cancelled and its receipts can no longer be deleted' using errcode='22023';
  end if;

  delete from public.manual_payments where id = p_id;

  select coalesce(sum(value_cents), 0) into v_remaining_received
    from public.manual_payments
    where parent_payment_id = v_parent.id and kind = 'receipt' and status = 'received';

  v_new_status := case
    when v_remaining_received >= v_parent.value_cents and v_remaining_received > 0 then 'received'
    when v_parent.due_date < current_date then 'overdue'
    else 'pending'
  end;

  update public.manual_payments
    set status = v_new_status,
        received_at = case when v_new_status = 'received' then now() else null end,
        updated_at = now()
    where id = v_parent.id
    returning * into v_parent;

  return jsonb_build_object('parent', to_jsonb(v_parent));
end $$;

revoke all on function public.delete_manual_payment_receipt(uuid) from public, anon, authenticated;
grant execute on function public.delete_manual_payment_receipt(uuid) to authenticated;


-- ============================================================================
-- 4) get_manual_payment_history — dados para a tela de Histórico do
--    Pagamento (NOVA)
-- ============================================================================
--
-- Contrato: recebe o id de uma cobrança (`kind = 'charge'`) e devolve a
-- própria cobrança (total original + status atual + nome do cliente),
-- quanto já foi recebido, o saldo restante, e todos os seus `receipt`
-- (mais recente primeiro). RLS de `manual_payments_owner_all` filtra
-- automaticamente por tenant (`security invoker`); um id de outro tenant
-- simplesmente não é encontrado (`PAYMENT_NOT_FOUND`), sem vazar existência.
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

  select coalesce(sum(value_cents), 0) into v_received_cents
    from public.manual_payments
    where parent_payment_id = p_id and kind = 'receipt' and status = 'received';

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


-- ============================================================================
-- 5) list_manual_payments — tabela principal só lista cobranças; resumo
--    financeiro recalculado sem duplicar valor entre pai e recibos
-- ============================================================================
--
-- Duas mudanças sobre 20260818130000:
-- (a) `v_total`/`v_items` passam a filtrar `kind = 'charge'` — os `receipt`
--     nunca mais aparecem como linha própria na tabela principal.
-- (b) `v_summary`: sob o novo design (`value_cents` do pai = total
--     imutável), somar `value_cents` de toda linha com `status = 'received'`
--     sem filtrar `kind` voltaria a contar em dobro (a cobrança inteira MAIS
--     os recibos que a quitaram). A regra correta, aplicada tanto aqui
--     quanto em `get_provider_dashboard_snapshot` e no adapter do dashboard
--     (`enrichRealDashboardMetrics`, ajuste feito em código de aplicação
--     nesta mesma entrega):
--       recebido = soma(recibos `received`, filtrados pelo período)
--                + soma(cobranças `received` SEM nenhum recibo filho,
--                       filtradas pelo período)
--       pendente = soma(total da cobrança - recebido daquela cobrança),
--                  para cobranças `pending`/`overdue` no período.
-- Filtro de período mantido idêntico ao já existente (por `due_date` da
-- própria linha) — não alterado nesta revisão.
create or replace function public.list_manual_payments(
  p_page integer default 1,
  p_page_size integer default 10,
  p_period text default null,
  p_status text default null,
  p_query text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := coalesce(p_page_size, 10);
  v_period_start date;
  v_period_end date;
  v_total integer;
  v_items jsonb;
  v_summary jsonb;
begin
  if v_page_size not in (5, 10) then
    raise exception 'PAYMENT_PAGE_SIZE_INVALID: page size must be 5 or 10'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'received', 'overdue', 'cancelled') then
    raise exception 'PAYMENT_STATUS_INVALID: invalid status' using errcode = '22023';
  end if;
  if p_period is not null and p_period !~ '^\d{4}(-\d{2})?$' then
    raise exception 'PAYMENT_PERIOD_INVALID: period must be YYYY or YYYY-MM' using errcode = '22023';
  end if;

  if length(coalesce(p_period, '')) = 4 then
    v_period_start := make_date(p_period::integer, 1, 1);
    v_period_end := v_period_start + interval '1 year';
  elsif length(coalesce(p_period, '')) = 7 then
    v_period_start := to_date(p_period || '-01', 'YYYY-MM-DD');
    if to_char(v_period_start, 'YYYY-MM') <> p_period then
      raise exception 'PAYMENT_PERIOD_INVALID: invalid month' using errcode = '22023';
    end if;
    v_period_end := v_period_start + interval '1 month';
  end if;

  select count(*)::integer
    into v_total
  from public.manual_payments payment
  join public.clients client on client.id = payment.client_id
  where payment.kind = 'charge'
    and (v_period_start is null or (payment.due_date >= v_period_start and payment.due_date < v_period_end))
    and (p_status is null or payment.status = p_status)
    and (nullif(btrim(p_query), '') is null
      or payment.origin ilike '%' || btrim(p_query) || '%'
      or client.name ilike '%' || btrim(p_query) || '%');

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
    into v_items
  from (
    select to_jsonb(payment) || jsonb_build_object(
      'client_name', client.name,
      'has_receipt', exists (
        select 1 from public.manual_payments receipt
        where receipt.parent_payment_id = payment.id and receipt.kind = 'receipt'
      )
    ) as row_data,
    payment.created_at
    from public.manual_payments payment
    join public.clients client on client.id = payment.client_id
    where payment.kind = 'charge'
      and (v_period_start is null or (payment.due_date >= v_period_start and payment.due_date < v_period_end))
      and (p_status is null or payment.status = p_status)
      and (nullif(btrim(p_query), '') is null
        or payment.origin ilike '%' || btrim(p_query) || '%'
        or client.name ilike '%' || btrim(p_query) || '%')
    order by payment.created_at desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) page_rows;

  select jsonb_build_object(
    'receivedTotalCents',
      coalesce((
        select sum(r.value_cents)
        from public.manual_payments r
        where r.kind = 'receipt' and r.status = 'received'
          and (v_period_start is null or (r.due_date >= v_period_start and r.due_date < v_period_end))
      ), 0)
      + coalesce((
        select sum(c.value_cents)
        from public.manual_payments c
        where c.kind = 'charge' and c.status = 'received'
          and not exists (
            select 1 from public.manual_payments cr
            where cr.parent_payment_id = c.id and cr.kind = 'receipt'
          )
          and (v_period_start is null or (c.due_date >= v_period_start and c.due_date < v_period_end))
      ), 0),
    'pendingTotalCents',
      coalesce((
        select sum(
          c.value_cents - coalesce((
            select sum(cr.value_cents)
            from public.manual_payments cr
            where cr.parent_payment_id = c.id and cr.kind = 'receipt' and cr.status = 'received'
          ), 0)
        )
        from public.manual_payments c
        where c.kind = 'charge' and c.status in ('pending', 'overdue')
          and (v_period_start is null or (c.due_date >= v_period_start and c.due_date < v_period_end))
      ), 0),
    'pendingCount',
      (
        select count(*)
        from public.manual_payments c
        where c.kind = 'charge' and c.status = 'pending'
          and (v_period_start is null or (c.due_date >= v_period_start and c.due_date < v_period_end))
      )
  )
    into v_summary;

  return jsonb_build_object(
    'items', v_items,
    'page', v_page,
    'pageSize', v_page_size,
    'totalItems', v_total,
    'totalPages', greatest(1, ceil(v_total::numeric / v_page_size)::integer),
    'summary', v_summary
  );
end;
$$;

revoke all on function public.list_manual_payments(integer, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_manual_payments(integer, integer, text, text, text)
  to authenticated;


-- ============================================================================
-- 6) get_provider_dashboard_snapshot — corrige bug pré-existente e alinha a
--    fórmula de "recebido" com `list_manual_payments`
-- ============================================================================
--
-- ACHADO INDEPENDENTE (fora do pedido original, mas na mesma função e
-- descoberto durante a validação desta entrega): a versão vigente em
-- produção desta RPC (20260817000500) referencia `status = 'paid'` — valor
-- que a constraint `manual_payments` (`check (status in ('pending',
-- 'received','overdue','cancelled'))`) nunca permite — e uma coluna
-- `paid_at` que NUNCA existiu na tabela. Confirmado em produção
-- (2026-08-23): `select ... where paid_at is null` falha com
-- `42703: column "paid_at" does not exist`. Isso significa que TODA chamada
-- a esta RPC lança erro em tempo de execução, e `SupabaseDashboardAdapter.
-- getSnapshot` (src/infra/dashboard/supabase-dashboard-adapter.ts) cai
-- silenciosamente no fallback `buildDirectDashboardSnapshot` para QUALQUER
-- erro que não seja 42501/JWT — mascarando o bug por completo em produção.
-- Corrigido aqui removendo toda referência a `paid_at`/`'paid'` e aplicando
-- a MESMA regra de `list_manual_payments` (recibos + cobranças quitadas sem
-- recibo, sem duplicar). Nenhum outro KPI desta função foi alterado.
create or replace function public.get_provider_dashboard_snapshot(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_user_display_name text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_month_start date;
  v_month_end date;
  v_summary jsonb;
  v_appointments jsonb;
begin
  -- 1. Busca o tenant do prestador
  select * into v_tenant
  from public.tenants
  where owner_user_id = auth.uid() and status = 'active'
  limit 1;

  -- 2. Se não existir, auto-provisiona o perfil e o tenant
  if not found then
    select coalesce(p.display_name, u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Prestador')
    into v_user_display_name
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.id = auth.uid();

    insert into public.profiles (user_id, role, display_name, phone)
    values (auth.uid(), 'provider', coalesce(v_user_display_name, 'Prestador'), null)
    on conflict (user_id) do update
    set role = 'provider'
    where public.profiles.role is distinct from 'provider';

    insert into public.profile_roles (user_id, role)
    values (auth.uid(), 'provider')
    on conflict (user_id, role) do nothing;

    insert into public.tenants (owner_user_id, display_name, timezone, status)
    values (auth.uid(), coalesce(v_user_display_name, 'Meu Espaço'), 'America/Sao_Paulo', 'active')
    returning * into v_tenant;

    insert into public.provider_settings (
      provider_user_id,
      timezone,
      slot_interval_minutes,
      min_advance_hours,
      business_hours_start,
      business_hours_end,
      booking_window_days
    ) values (
      auth.uid(),
      'America/Sao_Paulo',
      30,
      0,
      '08:00',
      '18:00',
      60
    ) on conflict (provider_user_id) do nothing;
  end if;

  -- 3. Datas e fusos
  v_date := coalesce(p_date, (now() at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))::date);
  v_start := v_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_end := (v_date + 1)::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  -- 4. KPIs do resumo consolidados
  select jsonb_build_object(
    -- Clientes Ativos: clientes cadastrados com status active
    'activeClients', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id and c.status = 'active'
    ), 0),

    -- Novos Clientes no Mês
    'newClientsThisMonth', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id
        and c.status = 'active'
        and c.created_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
        and c.created_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
    ), 0),

    -- Agendamentos de Hoje (total não cancelado no dia)
    'appointmentsToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
    ), 0),

    -- Atendimentos Concluídos Hoje
    'completedToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
        and (state = 'completed' or ends_at <= now())
    ), 0),

    -- Aguardando Confirmação Hoje
    'pendingConfirmationToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state = 'scheduled'
        and confirmation_status = 'pending'
    ), 0),

    -- Faturamento / Saldo Recebido no Mês — mesma regra de
    -- `list_manual_payments` (recibos quitados + cobranças quitadas sem
    -- nenhum recibo filho, evitando contar o mesmo valor duas vezes).
    -- Filtro por mês usa a mesma cascata `received_at -> due_date ->
    -- created_at` já usada pelo cálculo espelho em
    -- `enrichRealDashboardMetrics` (adapter), preservada aqui em vez de
    -- trocar para `due_date` puro (usado por `list_manual_payments`) porque
    -- o conceito de "faturamento do mês" desta tela sempre foi "quando o
    -- dinheiro entrou", não "quando a cobrança venceu" — nuance
    -- pré-existente e fora do escopo desta correção.
    'serviceBalanceCents',
      coalesce((
        select sum(r.value_cents)
        from public.manual_payments r
        where r.tenant_id = v_tenant.id
          and r.kind = 'receipt'
          and r.status = 'received'
          and coalesce(r.received_at, r.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), r.created_at)
            >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
          and coalesce(r.received_at, r.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), r.created_at)
            < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
      ), 0)
      + coalesce((
        select sum(c.value_cents)
        from public.manual_payments c
        where c.tenant_id = v_tenant.id
          and c.kind = 'charge'
          and c.status = 'received'
          and not exists (
            select 1 from public.manual_payments cr
            where cr.parent_payment_id = c.id and cr.kind = 'receipt'
          )
          and coalesce(c.received_at, c.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), c.created_at)
            >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
          and coalesce(c.received_at, c.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), c.created_at)
            < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
      ), 0),

    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  -- 5. Agendamentos de hoje (todos os compromissos do dia ordenados por horário)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', coalesce(c.name, 'Sem cliente'),
    'serviceName', coalesce(a.service_name_snapshot, 'Atendimento'),
    'serviceValueCents', coalesce(a.value_cents_snapshot, 0),
    'status', case
      when a.state = 'completed' or (a.ends_at <= now() and a.state <> 'cancelled') then 'completed'
      when a.state = 'cancelled' then 'cancelled'
      when a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.confirmation_status = 'no_show' then 'no_show'
      else 'confirmed'
    end
  ) order by a.starts_at asc), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  left join public.clients c on c.id = a.client_id
  where a.tenant_id = v_tenant.id
    and a.starts_at >= v_start
    and a.starts_at < v_end
    and a.state <> 'cancelled';

  return jsonb_build_object(
    'providerDisplayName', coalesce(v_tenant.display_name, 'Prestador'),
    'timeZone', coalesce(v_tenant.timezone, 'America/Sao_Paulo'),
    'summary', v_summary,
    'todayAppointments', v_appointments,
    'notifications', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;


-- ============================================================================
-- Verificações estruturais (mesmo padrão de outras migrations desta série,
-- ex.: 20260819100000) — checam a definição das funções sem depender de
-- sessão/JWT.
-- ============================================================================
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'register_manual_partial_payment';

  assert v_definition not like '%value_cents=value_cents-p_amount_cents%',
    'register_manual_partial_payment não deveria mais decrementar value_cents da cobrança';
  assert v_definition like '%v_received_before%',
    'register_manual_partial_payment deveria derivar o saldo a partir dos recibos já recebidos';

  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'list_manual_payments';

  assert v_definition like '%payment.kind = ''charge''%',
    'list_manual_payments deveria filtrar a tabela principal por kind = charge';

  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_provider_dashboard_snapshot';

  assert v_definition not like '%paid_at%',
    'get_provider_dashboard_snapshot não deveria mais referenciar a coluna inexistente paid_at';
  assert v_definition not like '%''paid''%',
    'get_provider_dashboard_snapshot não deveria mais referenciar o status inexistente paid';

  raise notice 'manual_payments_receipt_history: verificações estruturais passaram.';
end $$;

notify pgrst, 'reload schema';
