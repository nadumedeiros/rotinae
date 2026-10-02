-- Etapa 1 — appointments (docs/HANDOFF_AGENDA_CRIS.md; RN-AGD-001 a 024;
-- RN-CAN-001 a 007; RN-OBS-009/010; BACKLOG.md, BLG-051, DEC-074).
--
-- Depende de: 20260806101500_clients_registry.sql (clients),
-- 20260806101700_services_catalog.sql (services),
-- 20260806101800_provider_settings.sql (tenants.timezone/workday_*),
-- 20260806101900_national_holidays.sql (minimum_bookable_instant),
-- 20260806102000_availability_blocks.sql (availability_blocks, btree_gist).
--
-- As funções `SECURITY DEFINER` que validam e escrevem nesta tabela
-- (create_appointment, create_recurring_appointments, update_appointment,
-- cancel_appointment, confirm_appointment_manually) ficam em
-- 20260806102200_appointment_rpcs.sql — este arquivo cuida só de schema,
-- constraints, RLS, visibilidade de `internal_notes` e auditoria.
--
-- ============================================================================
-- DECISÃO DE DESIGN — nenhuma policy de INSERT/UPDATE para `authenticated`
-- ============================================================================
--
-- Diferente de `clients`/`services` (onde o prestador grava via `.insert()`/
-- `.update()` direto do adapter, sob RLS), `appointments` tem regras de
-- negócio demais para validar em uma WITH CHECK de policy (vínculo ativo,
-- serviço ativo, bloqueio de agenda, antecedência mínima, política de
-- limites do cliente, confirmação automática vs. manual, ator de
-- cancelamento vindo da sessão). Mesma decisão já tomada para
-- `provider_client_links` (sem policy de insert; só
-- `redeem_provider_link_code`) e reforçada aqui para INSERT E UPDATE: toda
-- escrita passa por uma função `SECURITY DEFINER` dedicada. Isso também
-- resolve de vez o critério "o cliente nunca recebe internalNotes" do lado
-- de ESCRITA — um cliente não tem como fazer um `update()` direto que grave
-- `internal_notes`, porque não existe policy de update para ele em nenhuma
-- hipótese.
--
-- DELETE continua sendo uma policy comum (só o proprietário do tenant),
-- porque "excluir registro incorreto" (handoff, endpoint sugerido) não tem
-- lógica de negócio além de permissão — e precisa disparar auditoria via
-- trigger `AFTER DELETE`, que funciona independentemente de RLS.
--
-- ============================================================================
-- DECISÃO DE DESIGN — visibilidade de internal_notes: VIEW dedicada, não
-- "o adapter lembra de não selecionar a coluna"
-- ============================================================================
--
-- RLS é por LINHA, não por COLUNA: uma policy de SELECT para o cliente na
-- tabela `appointments` continuaria permitindo `select=*` (ou qualquer
-- `select` que inclua `internal_notes`) para as PRÓPRIAS linhas do cliente.
-- A escolha mais resistente a erro futuro de implementação (handoff: "à
-- prova de esquecimento no adapter") é NÃO CONCEDER NENHUMA policy de SELECT
-- na tabela `appointments` para o papel do cliente — o cliente só enxerga
-- atendimentos através da view `appointments_client_view` (abaixo), que
-- projeta todas as colunas exceto `internal_notes`. Mesmo se um adaptador
-- futuro esquecer de filtrar a coluna no `.select()`, a coluna simplesmente
-- não existe no objeto retornado pela view — a omissão é estrutural, não
-- convencional.

do $$ begin
  create type appointment_state as enum ('scheduled', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_confirmation_status as enum ('pending', 'confirmed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appointment_confirmation_source as enum ('client', 'provider_manual');
exception when duplicate_object then null; end $$;

-- Reaproveitado tanto por `cancelled_by` (client|provider) quanto pela
-- resolução interna de `requestedBy` nas RPCs (20260806102200) — mesmo
-- domínio de valores de `AppointmentRequester` em domain/agenda/types.ts.
do $$ begin
  create type appointment_actor as enum ('client', 'provider');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Tabela appointments
-- ============================================================================

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- `clientId` do contrato é o CADASTRO em `clients`, nunca o
  -- `client_user_id`/identidade autenticada (domain/agenda/types.ts,
  -- comentário do handoff: "reveja types.ts"). `on delete restrict`: um
  -- cadastro de cliente nunca é excluído fisicamente (só arquivado, ver
  -- 20260806101500), então esta integridade referencial nunca chega a ser
  -- exercitada na prática, mas protege o histórico caso essa regra mude.
  client_id uuid not null references public.clients (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  -- Snapshots (RN-AGD-023): copiados do catálogo no momento da criação pela
  -- RPC; nunca reescritos por uma edição posterior do catálogo. Imutáveis
  -- após a criação (trigger abaixo).
  service_name_snapshot text not null
    constraint appointments_service_name_snapshot_not_blank_check
    check (char_length(btrim(service_name_snapshot)) > 0),
  value_cents_snapshot integer not null
    constraint appointments_value_snapshot_non_negative_check
    check (value_cents_snapshot >= 0),
  starts_at timestamptz not null,
  -- RN-AGD-008: o fuso oficial é o do prestador (`tenants.timezone`); as
  -- RPCs de escrita exigem que este valor seja idêntico ao do tenant no
  -- momento da chamada — a coluna existe para não perder o fuso em que o
  -- horário foi CONCEBIDO, caso o prestador troque de fuso depois.
  timezone text not null
    constraint appointments_timezone_valid_check check (public.is_valid_iana_timezone(timezone)),
  duration_minutes integer not null
    constraint appointments_duration_positive_check check (duration_minutes > 0),
  -- Materializado por trigger para que a exclusion constraint use apenas
  -- colunas. A soma de `timestamptz + interval` é STABLE no PostgreSQL e,
  -- portanto, não pode aparecer diretamente numa expressão de índice.
  ends_at timestamptz not null,
  state appointment_state not null default 'scheduled',
  confirmation_status appointment_confirmation_status not null default 'pending',
  confirmation_source appointment_confirmation_source,
  confirmed_at timestamptz,
  -- Mensagem compartilhada (RN-OBS-009): visível a prestador e cliente.
  -- Limite de tamanho e sanitização de exibição (handoff, critério mínimo de
  -- aceite "mensagem compartilhada é sanitizada e tem limite de tamanho") —
  -- o limite de tamanho é reforçado aqui; a sanitização de exibição (HTML/
  -- script) é responsabilidade da camada de apresentação, que já trata texto
  -- livre como texto puro em toda a base (nenhuma tela injeta HTML cru).
  client_message text
    constraint appointments_client_message_length_check
    check (client_message is null or char_length(client_message) <= 500),
  -- RN-OBS-010: nunca é lida pelo cliente. Ver decisão da view acima.
  internal_notes text
    constraint appointments_internal_notes_length_check
    check (internal_notes is null or char_length(internal_notes) <= 2000),
  cancellation_reason text
    constraint appointments_cancellation_reason_length_check
    check (cancellation_reason is null or char_length(cancellation_reason) <= 500),
  cancelled_by appointment_actor,
  cancelled_at timestamptz,
  recurrence_group_id uuid,
  recurrence_index integer
    constraint appointments_recurrence_index_check check (recurrence_index is null or recurrence_index >= 1),
  -- Teto de 24 ocorrências: limite desta interface/frontend já implementado
  -- (docs/HANDOFF_AGENDA_CRIS.md, "recorrência... entre 2 e 24 ocorrências"),
  -- mais restrito que o teto geral de 52 do produto (RN-REC-006). Se o
  -- produto decidir alinhar os dois números, esta constraint muda junto.
  recurrence_count integer
    constraint appointments_recurrence_count_check
    check (recurrence_count is null or recurrence_count between 2 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_cancellation_consistency_check check (
    (state = 'cancelled' and cancelled_at is not null and cancelled_by is not null)
    or (state <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
  ),
  constraint appointments_confirmation_consistency_check check (
    (confirmation_status = 'confirmed' and confirmation_source is not null and confirmed_at is not null)
    or (confirmation_status = 'pending' and confirmation_source is null and confirmed_at is null)
  )
);

create index if not exists appointments_tenant_starts_idx on public.appointments (tenant_id, starts_at);
create index if not exists appointments_client_idx on public.appointments (client_id);
create index if not exists appointments_recurrence_group_idx
  on public.appointments (recurrence_group_id)
  where recurrence_group_id is not null;

create or replace function public.set_appointment_ends_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.ends_at := new.starts_at + (new.duration_minutes * interval '1 minute');
  return new;
end;
$$;

drop trigger if exists appointments_set_ends_at on public.appointments;
create trigger appointments_set_ends_at
  before insert or update of starts_at, duration_minutes on public.appointments
  for each row
  execute function public.set_appointment_ends_at();

-- ============================================================================
-- Controle de concorrência transacional (handoff, item 7; critério de
-- aceite "conflito simultâneo é impedido no banco, não somente validado
-- antes") — EXCLUSION CONSTRAINT via GiST (btree_gist para "=" de uuid,
-- suporte nativo de range para "&&"). `tstzrange` com o padrão `'[)'`
-- (início inclusivo, fim exclusivo) permite agendamentos "encostados" (um
-- termina exatamente quando o outro começa) sem conflito falso-positivo.
-- Restrita a `state <> 'cancelled'` via a cláusula WHERE do índice parcial —
-- suportada em `ALTER TABLE ... ADD CONSTRAINT ... EXCLUDE ... WHERE (...)`
-- desde o Postgres 9.0, então um atendimento cancelado nunca "segura" o
-- horário para sempre.
-- ============================================================================

alter table public.appointments
  add constraint appointments_no_overlap_exclude
  exclude using gist (
    tenant_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (state <> 'cancelled');

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row
  execute function public.set_updated_at();

-- Imutabilidade seletiva (mesmo padrão de `enforce_clients_immutable_columns`/
-- `enforce_services_immutable_columns`, DEC-065): tenant/cliente/serviço e os
-- snapshots/vínculo de recorrência nunca mudam depois de criados. Reatribuir
-- cliente ou serviço equivaleria a um NOVO agendamento, não a uma remarcação
-- (RN-AGD-012 trata remarcação como mudança de horário/duração/mensagem).
create or replace function public.enforce_appointments_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: tenant_id cannot be changed' using errcode = '22023';
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: client_id cannot be changed' using errcode = '22023';
  end if;
  if new.service_id is distinct from old.service_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: service_id cannot be changed' using errcode = '22023';
  end if;
  if new.service_name_snapshot is distinct from old.service_name_snapshot then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: service_name_snapshot cannot be changed' using errcode = '22023';
  end if;
  if new.value_cents_snapshot is distinct from old.value_cents_snapshot then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: value_cents_snapshot cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_group_id is distinct from old.recurrence_group_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_group_id cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_index is distinct from old.recurrence_index then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_index cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_count is distinct from old.recurrence_count then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_count cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_immutable_columns on public.appointments;
create trigger appointments_immutable_columns
  before update on public.appointments
  for each row
  execute function public.enforce_appointments_immutable_columns();

alter table public.appointments enable row level security;

create policy "appointments_select_owner"
  on public.appointments for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = appointments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Sem policy de select para o cliente (ver decisão da view acima) e sem
-- policy de insert/update para ninguém (ver decisão no topo do arquivo).

create policy "appointments_delete_owner"
  on public.appointments for delete
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = appointments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- ============================================================================
-- View appointments_client_view — única forma de o cliente ler agendamentos
-- ============================================================================
--
-- Roda com o privilégio do OWNER da view (mesmo mecanismo de
-- `provider_pending_link_requests`, 20260806101600): o filtro de identidade
-- (`c.client_user_id = auth.uid()`) é resolvido a cada consulta a partir do
-- JWT da sessão, então continua correto por chamador mesmo a view
-- "bypassando" RLS de `appointments`/`clients` para fazer o join. Nenhuma
-- coluna de outro cliente é exposta. `internal_notes` NUNCA aparece na
-- lista de colunas abaixo — essa é a garantia estrutural do critério de
-- aceite "o cliente nunca recebe internalNotes em payload, log ou
-- notificação".
create view public.appointments_client_view as
select
  a.id,
  a.tenant_id,
  a.client_id,
  a.service_id,
  a.service_name_snapshot,
  a.value_cents_snapshot,
  a.starts_at,
  a.timezone,
  a.duration_minutes,
  a.state,
  a.confirmation_status,
  a.confirmation_source,
  a.confirmed_at,
  a.client_message,
  a.cancellation_reason,
  a.cancelled_by,
  a.cancelled_at,
  a.recurrence_group_id,
  a.recurrence_index,
  a.recurrence_count,
  a.created_at,
  a.updated_at
from public.appointments a
join public.clients c on c.id = a.client_id
where c.client_user_id = auth.uid();

revoke all on public.appointments_client_view from public, anon;
grant select on public.appointments_client_view to authenticated;

-- ============================================================================
-- Auditoria (handoff, item 8: "criação, alteração, cancelamento, exclusão e
-- confirmação manual sem copiar conteúdos sensíveis"). Nenhuma das funções
-- abaixo grava `client_message`/`internal_notes`/`cancellation_reason` — só
-- metadados (ação, ids, timestamps), mesmo princípio de todas as auditorias
-- anteriores desta série.
-- ============================================================================

-- Criação: reaproveita `audit_creation()` (20260806101100) — a tabela tem
-- `id`/`tenant_id`.
drop trigger if exists appointments_audit_creation on public.appointments;
create trigger appointments_audit_creation
  after insert on public.appointments
  for each row
  execute function public.audit_creation();

-- Mudança de estado (agendado -> concluído/cancelado/não compareceu): função
-- dedicada porque `audit_status_change()` (20260806101000) referencia
-- literalmente a coluna `status`, que aqui se chama `state`.
create or replace function public.audit_appointment_state_change()
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
    auth.uid(), new.tenant_id, 'appointments.state: ' || old.state || ' -> ' || new.state,
    'appointments', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_appointment_state_change() from public, anon, authenticated;

drop trigger if exists appointments_audit_state_change on public.appointments;
create trigger appointments_audit_state_change
  after update of state on public.appointments
  for each row
  when (old.state is distinct from new.state)
  execute function public.audit_appointment_state_change();

-- Confirmação manual (RN handoff: "confirmação manual grava
-- confirmationSource=provider_manual, confirmedAt, ator e auditoria").
create or replace function public.audit_appointment_confirmation()
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
    auth.uid(), new.tenant_id, 'appointments.confirmation: ' || new.confirmation_status,
    'appointments', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_appointment_confirmation() from public, anon, authenticated;

drop trigger if exists appointments_audit_confirmation on public.appointments;
create trigger appointments_audit_confirmation
  after update of confirmation_status on public.appointments
  for each row
  when (old.confirmation_status is distinct from new.confirmation_status)
  execute function public.audit_appointment_confirmation();

-- Remarcação (mudança de horário/duração), sem copiar o novo horário em si
-- (só o fato de ter mudado).
create or replace function public.audit_appointment_reschedule()
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
    auth.uid(), new.tenant_id, 'appointments.rescheduled', 'appointments', new.id, 'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_appointment_reschedule() from public, anon, authenticated;

drop trigger if exists appointments_audit_reschedule on public.appointments;
create trigger appointments_audit_reschedule
  after update of starts_at, duration_minutes on public.appointments
  for each row
  when (old.starts_at is distinct from new.starts_at or old.duration_minutes is distinct from new.duration_minutes)
  execute function public.audit_appointment_reschedule();

-- Exclusão administrativa: única forma de capturar DELETE (nenhuma função
-- genérica cobre TG_OP = 'DELETE'), mesmo padrão de
-- `audit_availability_block_deletion` (20260806102000).
create or replace function public.audit_appointment_deletion()
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
    auth.uid(), old.tenant_id, 'appointments.deleted', 'appointments', old.id, 'success'
  );

  return old;
end;
$$;

revoke all on function public.audit_appointment_deletion() from public, anon, authenticated;

drop trigger if exists appointments_audit_deletion on public.appointments;
create trigger appointments_audit_deletion
  after delete on public.appointments
  for each row
  execute function public.audit_appointment_deletion();
