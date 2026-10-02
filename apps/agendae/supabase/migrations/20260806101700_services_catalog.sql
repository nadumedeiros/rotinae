-- Catálogo de serviços do prestador (docs/HANDOFF_SERVICOS_CRIS.md,
-- seções 2/3; BACKLOG.md, BLG-048, DEC-070/071).
--
-- Fecha a lacuna registrada em DEC-070: `ServiceCatalogPort` (RF-CAD-004) foi
-- contratado no domínio, mas nenhuma tabela/RLS/adapter existia ainda —
-- `AppointmentRecord.serviceId`/`serviceNameSnapshot`/`valueCentsSnapshot`
-- (fora de escopo aqui, ver `docs/HANDOFF_AGENDA_CRIS.md`) e
-- `Client.primaryServiceId` pressupunham essa entidade sem ela nunca ter sido
-- implementada.
--
-- Mesma arquitetura de `clients` (20260806101500_clients_registry.sql):
-- RLS deny-by-default restrita ao proprietário do tenant, `tenant_id`
-- imutável após criação, `updated_at` automático via `set_updated_at()` e
-- auditoria via `audit_creation()`/`audit_status_change()` (genéricas,
-- reaproveitadas de 20260806101000/101100 — funcionam aqui porque `services`
-- também tem colunas `id`/`tenant_id`/`status`).
--
-- Nunca há exclusão física (handoff, regra 2): inativar é a única forma de
-- remover um serviço da oferta ativa. Por isso não existe policy de DELETE
-- nem trigger de auditoria de remoção — mesma convenção de `clients`.

do $$ begin
  create type service_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Tabela services
-- ============================================================================

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Constraint nomeada explicitamente para o adapter mapear
  -- SERVICE_NAME_INVALID sem depender do nome autogerado pelo Postgres.
  name text not null constraint services_name_not_blank_check check (char_length(btrim(name)) > 0),
  -- Insumo direto do cálculo de slots de agenda (RN-AGD-002, RN-AGD-003):
  -- inteiro estrito e maior que zero.
  duration_minutes integer not null constraint services_duration_positive_check check (duration_minutes > 0),
  -- Valor "de tabela" em centavos, não um histórico (handoff, regra 3):
  -- editar esta coluna nunca reescreve `AppointmentRecord.valueCentsSnapshot`
  -- nem `Client.serviceValueCents` já persistidos — esses campos vivem em
  -- outras tabelas e não são tocados por este schema.
  reference_value_cents integer not null constraint services_value_non_negative_check check (reference_value_cents >= 0),
  status service_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists services_tenant_idx on public.services (tenant_id);
create index if not exists services_tenant_status_idx on public.services (tenant_id, status);

-- Índice único parcial (handoff, seção 3): evita dois serviços ATIVOS com o
-- mesmo nome (case-insensitive) no mesmo tenant, sem impedir reaproveitar um
-- nome já usado por um serviço inativo (histórico não é apagado). Nome
-- alinhado à convenção `<tabela>_<escopo>_uk` já usada em
-- `clients_tenant_normalized_email_active_uk`.
create unique index if not exists services_tenant_active_name_uk
  on public.services (tenant_id, lower(btrim(name)))
  where status = 'active';

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row
  execute function public.set_updated_at();

-- Imutabilidade seletiva: tenant_id nunca muda após a criação — mesma
-- decisão de `enforce_clients_immutable_columns` (DEC-065): RLS using/with
-- check não compara old/new, então o trigger é a barreira do "o quê" pode
-- mudar.
create or replace function public.enforce_services_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'SERVICE_IMMUTABLE_FIELD: tenant_id cannot be changed' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists services_immutable_columns on public.services;
create trigger services_immutable_columns
  before update on public.services
  for each row
  execute function public.enforce_services_immutable_columns();

alter table public.services enable row level security;

-- Deny-by-default. Somente o proprietário do tenant lê/muta os próprios
-- serviços (mesmo padrão de `clients_select_owner`/`clients_insert_owner`/
-- `clients_update_owner`). Sem policy de select/insert/update para outra
-- identidade e sem policy de delete: exclusão é sempre inativação lógica
-- (deactivateService -> status='inactive'), nunca DELETE físico pela tela.

create policy "services_select_owner"
  on public.services for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = services.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "services_insert_owner"
  on public.services for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = services.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "services_update_owner"
  on public.services for update
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = services.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = services.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Auditoria de criação/mudança de status: reaproveita audit_creation()/
-- audit_status_change() (20260806101000/101100), já usadas por
-- tenants/provider_client_links/provider_link_codes/clients. Nenhum dado
-- sensível é copiado (não há dado sensível neste domínio), só metadados —
-- mantido por consistência (handoff, seção 5: "critério mínimo de aceite").
drop trigger if exists services_audit_creation on public.services;
create trigger services_audit_creation
  after insert on public.services
  for each row
  execute function public.audit_creation();

drop trigger if exists services_audit_status_change on public.services;
create trigger services_audit_status_change
  after update of status on public.services
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();

-- `audit_creation`/`audit_status_change` cobrem criação e mudança de status,
-- mas não editar nome/duração/valor de referência (handoff, seção 5:
-- "todas as mutações produzem evento de auditoria"). Diferente de
-- `clients.service_value_cents`/limites (20260806101500_clients_registry.sql,
-- que registra essa mesma lacuna como conhecida), aqui cobrimos o caso
-- porque não há decisão pendente sobre granularidade: nenhum dos três campos
-- é sensível (nome, duração e valor de tabela já são expostos ao próprio
-- prestador na tela de catálogo), então auditar o evento completo não
-- levanta a mesma dúvida de "o que é seguro registrar".
create or replace function public.audit_service_field_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(), new.tenant_id, 'services.updated', 'services', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_service_field_change() from public, anon, authenticated;

drop trigger if exists services_audit_field_change on public.services;
create trigger services_audit_field_change
  after update of name, duration_minutes, reference_value_cents on public.services
  for each row
  when (
    old.name is distinct from new.name
    or old.duration_minutes is distinct from new.duration_minutes
    or old.reference_value_cents is distinct from new.reference_value_cents
  )
  execute function public.audit_service_field_change();

-- ============================================================================
-- Extensão aditiva de clients (handoff, seção 3: "Extensão de clients")
-- ============================================================================
--
-- Coluna nova, nula por padrão — não afeta nenhuma linha existente nem exige
-- backfill. `on delete restrict` (mais explícito que o padrão do Postgres,
-- que já é RESTRICT): como `services` nunca é excluído fisicamente (ver
-- regra 2 acima), essa integridade referencial não chega a ser exercitada na
-- prática, mas protege o dado caso essa regra mude no futuro. RLS de
-- `clients` já existente não precisa mudar: a nova coluna é só mais um campo
-- da mesma linha, sujeito à mesma policy.
alter table public.clients
  add column if not exists primary_service_id uuid null references public.services (id) on delete restrict;

create index if not exists clients_primary_service_idx on public.clients (primary_service_id);
