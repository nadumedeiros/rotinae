-- Controle financeiro manual. Não processa transações bancárias.
create table if not exists public.manual_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  -- Nomeadas explicitamente (mesmo padrão de `services`, DEC-071) para que o
  -- mapeamento de erro do adaptador (`mapPaymentError`) não dependa do nome
  -- autogerado pelo Postgres para constraints de coluna.
  origin text not null constraint manual_payments_origin_length_check check (length(trim(origin)) between 1 and 160),
  value_cents integer not null constraint manual_payments_value_cents_non_negative_check check (value_cents >= 0),
  due_date date not null,
  status text not null check (status in ('pending','received','overdue','cancelled')),
  notes text,
  kind text not null default 'charge' check (kind in ('charge','receipt')),
  -- Nomeada explicitamente (revisão final de governança, achado do Leon:
  -- excluir uma `charge` que já tem `receipt` filho cai em erro genérico)
  -- para que `mapPaymentError` reconheça esta violação de FK específica sem
  -- depender do nome autogerado pelo Postgres, mesmo padrão das constraints
  -- de check acima (DEC-093).
  parent_payment_id uuid constraint manual_payments_parent_payment_fk
    references public.manual_payments(id) on delete restrict,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_payments_receipt_parent_check check
    ((kind = 'charge' and parent_payment_id is null) or
     (kind = 'receipt' and parent_payment_id is not null))
);

create index if not exists manual_payments_tenant_created_idx
  on public.manual_payments (tenant_id, created_at desc);

alter table public.manual_payments enable row level security;

create policy "manual_payments_owner_all" on public.manual_payments
  for all to authenticated
  using (exists (select 1 from public.tenants t where t.id = tenant_id and t.owner_user_id = auth.uid()))
  with check (
    exists (select 1 from public.tenants t where t.id = tenant_id and t.owner_user_id = auth.uid())
    and exists (select 1 from public.clients c where c.id = client_id and c.tenant_id = tenant_id)
  );

-- ============================================================================
-- DECISÃO DE DESIGN — `security invoker` (revisão do Chris, achado (d) de
-- DEC-092)
-- ============================================================================
--
-- Diferente das RPCs sensíveis de 20260806101300/101600/101800 (`security
-- definer`), esta função é deliberadamente `security invoker`, e a diferença
-- não é uma inconsistência: naquelas RPCs, `security definer` é necessário
-- porque a operação PRECISA atravessar a RLS de propósito (ex.:
-- `redeem_provider_link_code` varre `provider_link_codes` de QUALQUER tenant
-- para resolver um código antes de o cliente ter qualquer vínculo próprio;
-- `decide_provider_link_request`/`update_provider_settings` escrevem em mais
-- de uma tabela na mesma transação). Nesta função, todas as três operações
-- (o `select ... for update`, o `update` e o `insert` do recibo) permanecem
-- inteiramente dentro de linhas que já pertencem ao tenant do próprio
-- chamador — exatamente o que `manual_payments_owner_all` (`for all`) já
-- autoriza. Não há necessidade de ultrapassar a RLS.
--
-- Rodar como `security definer` aqui seria estritamente PIOR: no Supabase, a
-- função passaria a executar com o papel dono da função (que tipicamente
-- ignora RLS), então o `select ... for update` deixaria de filtrar por
-- `tenant_id`/`owner_user_id` e QUALQUER usuário autenticado poderia quitar
-- parcialmente o pagamento de QUALQUER outro tenant informando apenas o
-- `p_id`, a menos que a função replicasse manualmente a checagem de posse do
-- tenant no corpo (como `rotate_provider_link_code`/`decide_provider_link_request`
-- fazem explicitamente com `v_caller`/`join public.tenants`). Como nenhuma
-- checagem desse tipo existe aqui, `security invoker` não é só aceitável — é
-- a escolha correta, e trocar para `security definer` sem adicionar essas
-- checagens seria uma regressão de segurança multi-tenant grave. Mantida sem
-- alteração nesta revisão.
create or replace function public.register_manual_partial_payment(p_id uuid, p_amount_cents integer)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_current public.manual_payments; v_receipt public.manual_payments;
begin
  if p_amount_cents <= 0 then raise exception 'PAYMENT_VALUE_INVALID: amount must be greater than zero' using errcode='22023'; end if;
  select * into v_current from public.manual_payments where id=p_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND: payment not found' using errcode='P0002'; end if;
  -- `status='cancelled'` é checado separadamente de `status='received'` (achado
  -- Alto da auditoria do Leon, DEC-094): `updatePayment` permite mudar `status`
  -- para `cancelled` livremente via UPDATE comum, sem regra de transição no
  -- banco. Antes desta correção, uma cobrança cancelada continuava elegível
  -- para esta RPC (só `status='received'` era bloqueado), então quitar
  -- parcialmente uma cobrança já cancelada decrementava `value_cents` e,
  -- ao zerar, definia `status='received'` de volta — reabrindo silenciosamente
  -- uma cobrança que deveria estar morta, um efeito colateral inaceitável de
  -- integridade financeira. `PAYMENT_CANCELLED` é deliberadamente um código
  -- distinto de `PAYMENT_ALREADY_SETTLED`: são estados terminais diferentes
  -- (quitado vs. cancelado) e o adaptador/UI podem querer tratá-los com
  -- mensagens diferentes. Reabrir uma cobrança cancelada, se algum dia for
  -- necessário, deve ser um fluxo deliberado e explícito (ex.: criar uma nova
  -- cobrança, ou uma operação própria de "reabrir") — nunca um efeito
  -- colateral de `register_manual_partial_payment`.
  if v_current.kind <> 'charge' or v_current.status='cancelled' then
    raise exception 'PAYMENT_CANCELLED: payment was cancelled and cannot receive a partial payment' using errcode='22023';
  end if;
  if v_current.status='received' or v_current.value_cents <= 0 then
    raise exception 'PAYMENT_ALREADY_SETTLED: payment is already settled or not eligible for partial payment' using errcode='22023';
  end if;
  if p_amount_cents > v_current.value_cents then raise exception 'PAYMENT_EXCEEDS_BALANCE: amount exceeds pending balance' using errcode='22023'; end if;
  update public.manual_payments set value_cents=value_cents-p_amount_cents,
    status=case when value_cents-p_amount_cents=0 then 'received' else 'pending' end,
    received_at=case when value_cents-p_amount_cents=0 then now() else null end, updated_at=now()
    where id=p_id returning * into v_current;
  insert into public.manual_payments(tenant_id,client_id,origin,value_cents,due_date,status,notes,kind,parent_payment_id,received_at)
    values(v_current.tenant_id,v_current.client_id,'Valor quitado — '||v_current.origin,p_amount_cents,current_date,'received',v_current.notes,'receipt',v_current.id,now())
    returning * into v_receipt;
  return jsonb_build_object('pending', to_jsonb(v_current), 'receipt', to_jsonb(v_receipt));
end $$;

-- Sem este `revoke`, o `grant` abaixo conviveria com o `EXECUTE` padrão que o
-- Postgres concede a `PUBLIC` na criação da função, deixando `anon` capaz de
-- chamar a RPC (mesmo que a RLS acabe barrando o efeito prático via
-- `for update`/`update`/`insert`). Todas as demais RPCs sensíveis do projeto
-- (20260806101300/101600/101800) revogam explicitamente antes de conceder;
-- esta função tinha ficado de fora dessa revogação — corrigido nesta revisão
-- por defesa em profundidade, sem mudança de comportamento para o prestador
-- autenticado e dono do tenant.
revoke all on function public.register_manual_partial_payment(uuid,integer) from public, anon, authenticated;
grant execute on function public.register_manual_partial_payment(uuid,integer) to authenticated;

-- ============================================================================
-- Auditoria (revisão do Chris, achado (c) de DEC-092)
-- ============================================================================
--
-- DEC-014 exige auditoria de ajuste manual de valores financeiros; DEC-022
-- exige auditoria de ações críticas em geral. `manual_payments` tinha ficado
-- sem qualquer trigger de auditoria, diferente de todas as demais tabelas
-- sensíveis do projeto (`clients`/`client_notes`, `services`,
-- `provider_client_links`, `tenants`, `profiles`). Fecha-se a lacuna
-- reaproveitando as funções genéricas já existentes onde elas servem, e
-- criando uma função dedicada só para o que elas não cobrem — mesmo padrão
-- de `services`/`clients` (20260806101500/101700).

-- `audit_creation`/`audit_status_change` (20260806101000/101100) servem sem
-- modificação: a tabela tem as colunas genéricas `id`/`tenant_id`/`status`
-- que essas funções esperam. `audit_creation` cobre tanto a criação de uma
-- cobrança (`kind='charge'`) quanto a criação da linha filha de recibo
-- (`kind='receipt'`, inserida por `register_manual_partial_payment`) — ambas
-- são o mesmo evento de banco (INSERT), sem distinção de `kind` no log,
-- como já ocorre nas demais tabelas que reaproveitam esta função genérica.
drop trigger if exists manual_payments_audit_creation on public.manual_payments;
create trigger manual_payments_audit_creation
  after insert on public.manual_payments
  for each row
  execute function public.audit_creation();

drop trigger if exists manual_payments_audit_status_change on public.manual_payments;
create trigger manual_payments_audit_status_change
  after update of status on public.manual_payments
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();

-- `audit_creation`/`audit_status_change` não cobrem edição manual de
-- `origin`/`value_cents`/`due_date` sem mudança de status (ex.: corrigir o
-- valor ou a data de uma cobrança ainda pendente) nem a exclusão de um
-- registro financeiro — exatamente o "ajuste manual" que DEC-014 exige
-- auditar. Nenhum dos três campos é sensível no sentido do princípio 7 (não
-- é conteúdo livre como `client_notes.content`; é o mesmo tipo de dado
-- operacional que `services.name/duration_minutes/reference_value_cents` já
-- audita em texto, DEC-071), então o evento completo pode ser registrado sem
-- levantar a mesma dúvida de granularidade documentada em
-- `clients.service_value_cents` (20260806101500). Cobre também o DELETE:
-- diferente de `clients`/`services` (nunca excluídos fisicamente pela tela),
-- `PaymentPort.deletePayment` permite exclusão física, e sem este trigger a
-- remoção de um registro financeiro não deixaria nenhum rastro além do
-- evento de criação original.
-- ============================================================================
-- Diff de valor auditável (revisão final de governança — achado Médio-Alto
-- do Leon)
-- ============================================================================
--
-- `audit_payment_mutation()` registrava "algo mudou" em `audit_events`
-- (quem/quando/qual linha/qual ação), mas não "quanto mudou" — insuficiente
-- para investigação forense de um ajuste financeiro indevido (ex.: um
-- prestador reduz `value_cents` de uma cobrança pendente sem justificativa;
-- o evento de auditoria hoje não permite reconstruir o valor anterior sem
-- recorrer a um backup externo do banco).
--
-- Duas abordagens foram avaliadas: (a) estender `audit_events` (tabela
-- genérica, 20260806100900) com colunas `old_value`/`new_value` jsonb,
-- beneficiando também `clients`/`services`/`tenants`/`provider_client_links`;
-- (b) capturar o diff apenas para `manual_payments`, sem tocar o schema
-- compartilhado. Optou-se por (b), por três razões: 1) `audit_events` é
-- documentada explicitamente em `docs/ARQUITETURA_BACKEND_ETAPA_1.md`
-- (seção 4.8) como NÃO armazenando "payload financeiro completo" — mesmo um
-- diff estruturado de valores monetários é, em espírito, o tipo de dado que
-- essa restrição pretende manter fora da tabela de auditoria genérica;
-- reabrir essa decisão de arquitetura para acomodar `manual_payments`
-- extrapolaria o escopo desta rodada (mudança de contrato/documentação que
-- afetaria leitura/retenção de auditoria de todo o projeto). 2) Nenhuma das
-- outras quatro tabelas que usam `audit_events` (`clients`/`services`/
-- `tenants`/`provider_client_links`) tem, até este momento, um achado
-- concreto pedindo diff de valor — estender o schema compartilhado hoje
-- seria especulativo (YAGNI), não uma necessidade comprovada. 3) Uma tabela
-- dedicada tem blast radius estritamente menor: nenhuma migration de
-- `audit_events` (usada por 4+ tabelas) é reaberta, e o pior caso de um bug
-- nesta função fica contido a `manual_payments`. Se um dia outra tabela
-- sensível do projeto precisar do mesmo tipo de diff, estender
-- `audit_events` (ou extrair um padrão comum) volta a ser a escolha certa —
-- não há hoje.
create table if not exists public.manual_payments_value_history (
  id uuid primary key default gen_random_uuid(),
  -- Sem FK para `manual_payments`/`tenants`: esta é uma tabela de histórico
  -- append-only (mesmo espírito de `audit_events.resource_id`, que também
  -- não tem FK) e o trigger que a alimenta roda em `after delete` — a linha
  -- de `manual_payments` já não existe mais no momento do insert, então uma
  -- FK `on delete restrict`/`cascade` para `manual_payments(id)` quebraria
  -- exatamente o caso de exclusão que esta tabela existe para registrar.
  payment_id uuid not null,
  tenant_id uuid not null,
  action text not null check (action in ('updated', 'deleted')),
  changed_by uuid references auth.users (id),
  old_client_id uuid,
  new_client_id uuid,
  old_origin text,
  new_origin text,
  old_value_cents integer,
  new_value_cents integer,
  old_due_date date,
  new_due_date date,
  changed_at timestamptz not null default now()
);

create index if not exists manual_payments_value_history_payment_idx
  on public.manual_payments_value_history (payment_id, changed_at desc);
create index if not exists manual_payments_value_history_tenant_idx
  on public.manual_payments_value_history (tenant_id);

alter table public.manual_payments_value_history enable row level security;
-- Nenhuma policy adicionada de propósito, mesmo padrão de `audit_events`
-- (20260806100900): RLS habilitada + zero policies = acesso negado por
-- completo a `anon`/`authenticated`. Escrita acontece só via
-- `audit_payment_mutation()` (`security definer`); leitura administrativa
-- futura (se necessária) deve passar por `service_role` ou por uma função
-- `security definer` dedicada, nunca pela app — mesmo modelo de acesso da
-- auditoria genérica.

create or replace function public.audit_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_resource_id uuid;
  v_action text;
  v_history_action text;
  v_old_client_id uuid;
  v_new_client_id uuid;
  v_old_origin text;
  v_new_origin text;
  v_old_value_cents integer;
  v_new_value_cents integer;
  v_old_due_date date;
  v_new_due_date date;
begin
  -- Os campos `new_*` só são atribuídos no ramo `else` (UPDATE): referenciar
  -- `new.<coluna>` diretamente dentro de uma expressão avaliada também em
  -- contexto de DELETE lançaria "record "new" is not assigned yet" em
  -- plpgsql (NEW não existe em gatilhos AFTER DELETE). Por isso os valores
  -- são pré-computados em variáveis locais dentro do IF/ELSE, nunca lidos de
  -- `new.*` fora do ramo que garante sua existência — mesmo cuidado que já
  -- protegia `v_tenant_id`/`v_resource_id`/`v_action` nesta função antes
  -- desta revisão.
  if TG_OP = 'DELETE' then
    v_tenant_id := old.tenant_id;
    v_resource_id := old.id;
    v_action := 'manual_payments.deleted';
    v_history_action := 'deleted';
    v_old_client_id := old.client_id;
    v_old_origin := old.origin;
    v_old_value_cents := old.value_cents;
    v_old_due_date := old.due_date;
  else
    v_tenant_id := new.tenant_id;
    v_resource_id := new.id;
    v_action := 'manual_payments.updated';
    v_history_action := 'updated';
    v_old_client_id := old.client_id;
    v_new_client_id := new.client_id;
    v_old_origin := old.origin;
    v_new_origin := new.origin;
    v_old_value_cents := old.value_cents;
    v_new_value_cents := new.value_cents;
    v_old_due_date := old.due_date;
    v_new_due_date := new.due_date;
  end if;

  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(), v_tenant_id, v_action, 'manual_payments', v_resource_id, 'success'
  );

  -- Diff auditável dedicado (achado Médio-Alto do Leon, ver comentário
  -- extenso acima de `manual_payments_value_history`): grava, na mesma
  -- transação do evento genérico, o valor anterior/posterior de
  -- `client_id`/`origin`/`value_cents`/`due_date`. Em `DELETE`, os campos
  -- `new_*` ficam `null` (nada a comparar; o registro deixou de existir).
  insert into public.manual_payments_value_history (
    payment_id, tenant_id, action, changed_by,
    old_client_id, new_client_id,
    old_origin, new_origin,
    old_value_cents, new_value_cents,
    old_due_date, new_due_date
  )
  values (
    v_resource_id, v_tenant_id, v_history_action, auth.uid(),
    v_old_client_id, v_new_client_id,
    v_old_origin, v_new_origin,
    v_old_value_cents, v_new_value_cents,
    v_old_due_date, v_new_due_date
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_payment_mutation() from public, anon, authenticated;

-- Nota: quando `register_manual_partial_payment` altera `value_cents` E
-- zera o saldo (status muda para `received`), este trigger e
-- `manual_payments_audit_status_change` disparam os DOIS na mesma
-- transação — dois eventos para a mesma ação de negócio. Isso é redundante,
-- mas não incorreto: o mesmo comportamento já existe onde `services`
-- audita status e campos separadamente (20260806101700); mantido por
-- consistência em vez de introduzir deduplicação nova sem necessidade
-- comprovada (YAGNI).
-- `client_id` foi adicionado à lista de colunas monitoradas (achado Médio da
-- revisão final de governança): `UpdatePaymentInput` permite reatribuir uma
-- cobrança para outro cliente do mesmo tenant via `updatePayment`, e essa
-- mudança passava sem qualquer auditoria antes desta revisão — mesmo padrão
-- de tratamento dos demais campos monitorados abaixo.
drop trigger if exists manual_payments_audit_field_change on public.manual_payments;
create trigger manual_payments_audit_field_change
  after update of origin, value_cents, due_date, client_id on public.manual_payments
  for each row
  when (
    old.origin is distinct from new.origin
    or old.value_cents is distinct from new.value_cents
    or old.due_date is distinct from new.due_date
    or old.client_id is distinct from new.client_id
  )
  execute function public.audit_payment_mutation();

drop trigger if exists manual_payments_audit_delete on public.manual_payments;
create trigger manual_payments_audit_delete
  after delete on public.manual_payments
  for each row
  execute function public.audit_payment_mutation();
