-- Etapa 1 — availability_blocks (docs/HANDOFF_AGENDA_CRIS.md, seção
-- "Precedência do bloqueio"; docs/REGRAS_DE_NEGOCIO_MVP.md, RN-AGD-024;
-- BACKLOG.md, BLG-051, DEC-074).
--
-- Insumo de disponibilidade consumido por `appointments`
-- (20260806102100_appointments.sql / 20260806102200_appointment_rpcs.sql):
-- um bloqueio ativo impede CRIAÇÃO/REMARCAÇÃO solicitada pelo cliente que
-- sobreponha o período, mas nunca cancela ou altera compromissos já
-- existentes (RN-AGD-024, RN-AGD-013).
--
-- ============================================================================
-- DECISÃO DE DESIGN — "conflictPolicy: 'keep_existing'" é satisfeito pela
-- AUSÊNCIA estrutural de qualquer efeito colateral, não por um parâmetro
-- ============================================================================
--
-- `CreateAvailabilityBlockInput.conflictPolicy` (domain/agenda/types.ts) só
-- aceita o literal `'keep_existing'` — não existe (e nunca existirá) um modo
-- que cancele em lote. Este schema não modela essa garantia como uma coluna
-- ou uma flag de comportamento: ela é satisfeita estruturalmente porque
-- NENHUM trigger, FK ON DELETE/CASCADE ou função desta migration toca a
-- tabela `appointments` a partir de um INSERT em `availability_blocks`. A
-- verificação de sobreposição com um bloqueio acontece só no MOMENTO da
-- criação/remarcação de um agendamento pelo CLIENTE (consulta de leitura em
-- `_create_appointment_row`/`update_appointment`, ver
-- 20260806102200_appointment_rpcs.sql) — nunca no sentido inverso.
--
-- ============================================================================
-- Tabela availability_blocks
-- ============================================================================

create extension if not exists btree_gist; -- exclusion constraint abaixo e a de `appointments`.

create table if not exists public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null constraint availability_blocks_timezone_valid_check
    check (public.is_valid_iana_timezone(timezone)),
  reason text constraint availability_blocks_reason_length_check
    check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  -- Preenchido pelo próprio banco a partir da sessão (nunca aceito do corpo
  -- da requisição) — mesmo espírito de `cancelled_by`/`decided_by` nas
  -- tabelas de vínculo: a "identidade de quem agiu" nunca é um campo de
  -- input livre.
  created_by uuid not null default auth.uid() references public.profiles (user_id),
  constraint availability_blocks_period_order_check check (ends_at > starts_at)
);

create index if not exists availability_blocks_tenant_idx on public.availability_blocks (tenant_id);
create index if not exists availability_blocks_tenant_period_idx
  on public.availability_blocks (tenant_id, starts_at, ends_at);

-- Nenhum bloqueio pode sobrepor outro bloqueio do MESMO tenant — evita
-- duplicidade operacional (dois registros cobrindo o mesmo período). Mapeada
-- pelo adapter para `AGENDA_BLOCK_OVERLAP` (já previsto em
-- `AppointmentErrorCode`). Diferente da exclusion constraint de
-- `appointments` (20260806102100), esta não tem cláusula WHERE: um bloqueio
-- nunca é "cancelado", só existe ou é excluído.
alter table public.availability_blocks
  add constraint availability_blocks_no_overlap_exclude
  exclude using gist (
    tenant_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  );

alter table public.availability_blocks enable row level security;

-- Deny-by-default. Proprietário do tenant lê/cria/exclui. Cliente com vínculo
-- ATIVO só LÊ (para a agenda do cliente sinalizar dias bloqueados antes de
-- tentar agendar) — nunca cria nem exclui bloqueio.
--
-- Sem policy de UPDATE: `AppointmentPort` só expõe `createAvailabilityBlock`/
-- `deleteAvailabilityBlock` — bloqueios não são editados, só recriados.

create policy "availability_blocks_select_owner"
  on public.availability_blocks for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = availability_blocks.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "availability_blocks_select_linked_client"
  on public.availability_blocks for select
  to authenticated
  using (
    exists (
      select 1 from public.provider_client_links l
      where l.tenant_id = availability_blocks.tenant_id
        and l.client_user_id = auth.uid()
        and l.status = 'active'
    )
  );

create policy "availability_blocks_insert_owner"
  on public.availability_blocks for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.tenants t
      where t.id = availability_blocks.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "availability_blocks_delete_owner"
  on public.availability_blocks for delete
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = availability_blocks.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Auditoria de criação: reaproveita `audit_creation()` (20260806101100) —
-- funciona porque a tabela tem colunas `id`/`tenant_id`. Exclusão precisa de
-- uma função dedicada (nenhuma genérica cobre DELETE ainda), mesmo padrão de
-- `audit_client_note_event` (20260806101500).
drop trigger if exists availability_blocks_audit_creation on public.availability_blocks;
create trigger availability_blocks_audit_creation
  after insert on public.availability_blocks
  for each row
  execute function public.audit_creation();

create or replace function public.audit_availability_block_deletion()
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
    auth.uid(), old.tenant_id, 'availability_blocks.deleted', 'availability_blocks', old.id, 'success'
  );

  return old;
end;
$$;

revoke all on function public.audit_availability_block_deletion() from public, anon, authenticated;

drop trigger if exists availability_blocks_audit_deletion on public.availability_blocks;
create trigger availability_blocks_audit_deletion
  after delete on public.availability_blocks
  for each row
  execute function public.audit_availability_block_deletion();
