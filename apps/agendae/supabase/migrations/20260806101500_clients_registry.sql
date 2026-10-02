-- Etapa 1 — clients e client_notes (docs/HANDOFF_CLIENTES_VINCULO_CRIS.md,
-- seções 3/4/8; BACKLOG.md, BLG-045, DEC-069).
--
-- Fecha a lacuna registrada em DEC-066: até esta migration só existia o
-- caminho de vínculo por código (`provider_client_links`/`provider_link_codes`);
-- não havia onde persistir o cadastro interno do cliente (feito pelo
-- prestador, sem depender de o cliente ter conta), o valor cobrado, a
-- política de agendamento por cliente (regra 9/10 do handoff) nem as
-- anotações internas (seção 8 do handoff).
--
-- ============================================================================
-- DECISÃO DE DESIGN — política de agendamento embutida em `clients`, sem
-- tabela própria versionada (`provider_client_booking_policies`)
-- ============================================================================
--
-- O handoff (seção 3) recomenda uma tabela própria por vínculo para manter
-- histórico de alterações de `service_value_cents`/limites. Esta migration
-- opta pela alternativa mais simples — colunas diretas em `clients` — porque:
--
-- 1. Não existe ainda nenhum schema de agenda/atendimento (RF-AGE) que
--    consuma esse histórico: a Etapa 1 desta entrega explicitamente NÃO
--    resolve reserva de cota nem cópia de snapshot no agendamento (fora de
--    escopo — ver nota no handoff, seção 3, "cópia de snapshot no
--    agendamento" pertence à função de criação/remarcação, ainda
--    inexistente). Sem consumidor do histórico, versionar agora é
--    especulativo (YAGNI).
-- 2. Sem uma tabela de agendamentos que referencie qual política estava
--    vigente em cada atendimento passado, um histórico de
--    `provider_client_booking_policies` não teria como ser correlacionado a
--    nada — persistiria versões sem nenhuma consulta real as usar.
-- 3. Isso é uma decisão desta etapa, não definitiva: quando RF-AGE/agenda for
--    implementado, se o requisito de auditoria de "qual política valia
--    quando o atendimento X foi criado" for confirmado como necessário,
--    extrair essas colunas para uma tabela versionada (com FK do
--    agendamento para a versão vigente) é a evolução recomendada. Registrar
--    essa extração como nova decisão (DEC-NNN) quando ocorrer.
--
-- Enquanto os limites/valor vivem em `clients`, alterá-los é um UPDATE comum
-- (auditado por `audit_status_change`/trigger dedicado só cobre `status`,
-- não estes campos — ver nota mais abaixo sobre o que fica de fora da
-- auditoria automática nesta etapa).

do $$ begin
  create type client_record_origin as enum ('provider_created', 'client_created', 'reconciled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- Tabela clients
-- ============================================================================

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- null enquanto for só um cadastro interno do prestador (seção "Reconciliação").
  client_user_id uuid references public.profiles (user_id),
  record_origin client_record_origin not null default 'provider_created',
  name text not null check (char_length(trim(name)) > 0),
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Coluna gerada para a comparação de duplicidade (regra 10/seção
  -- "Reconciliação"): normaliza para minúsculas e sem espaço nas bordas, o
  -- mesmo critério de `normalizeEmail` em link-reconciliation.ts.
  normalized_email text generated always as (lower(btrim(email))) stored,
  -- E.164; Brasil tipicamente "+55...". Opcional (handoff, "Telefone,
  -- WhatsApp e convite por e-mail": telefone só é obrigatório quando alguma
  -- finalidade de WhatsApp for autorizada — essa exigência condicional
  -- pertence à camada de mensageria, ainda não implementada, então aqui a
  -- coluna permanece simplesmente opcional).
  phone text check (phone is null or phone ~ '^\+[1-9]\d{6,14}$'),
  -- Apenas o estado do toggle capturado no cadastro (dado estrutural do
  -- registro). NÃO aciona envio, não verifica número e não registra
  -- consentimento auditável (`CommunicationConsentEvidence`) — isso
  -- pertence a `ClientMessagingPort`/outbox, bloqueado por BLG-010 e
  -- explicitamente fora do escopo desta entrega.
  whatsapp_confirmation_enabled boolean not null default false,
  whatsapp_reminder_enabled boolean not null default false,
  status client_status not null default 'active',
  primary_service text,
  service_value_cents integer not null default 0 check (service_value_cents >= 0),
  -- null = livre (regra 10 do handoff). Quando informado, 0 é rejeitado: um
  -- limite de zero atendimentos não é um estado de negócio válido (o
  -- cadastro existiria sem nunca poder agendar) — para "sem limite" o valor
  -- correto é null, nunca zero.
  total_booking_limit integer check (total_booking_limit is null or total_booking_limit >= 1),
  daily_booking_limit integer check (daily_booking_limit is null or daily_booking_limit >= 1),
  -- Datas civis no fuso do prestador (ver Client.bookingPolicy). Ambos null
  -- = período livre; caso contrário os dois são obrigatórios e coerentes.
  request_window_start date,
  request_window_end date,
  constraint clients_booking_window_pair check (
    (request_window_start is null and request_window_end is null)
    or (
      request_window_start is not null
      and request_window_end is not null
      and request_window_start <= request_window_end
    )
  ),
  -- Populado pela futura camada de agenda/atendimento (RF-AGE, fora desta
  -- entrega); nasce sempre null aqui.
  last_service_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_tenant_idx on public.clients (tenant_id);
create index if not exists clients_tenant_status_idx on public.clients (tenant_id, status);
create index if not exists clients_client_user_idx on public.clients (client_user_id);

-- Restrições da seção "Reconciliação" do handoff:
-- 1) único e-mail normalizado por tenant entre os registros não arquivados
--    (arquivamento = status 'inactive' nesta etapa, já que o domínio não tem
--    um terceiro estado "archived" — ver Client.status em domain/clients/types.ts).
--    Isso libera o e-mail para reuso depois que o cadastro antigo é arquivado.
create unique index if not exists clients_tenant_normalized_email_active_uk
  on public.clients (tenant_id, normalized_email)
  where status = 'active';

-- 2) no máximo um cadastro por identidade de cliente dentro do tenant.
create unique index if not exists clients_tenant_client_user_uk
  on public.clients (tenant_id, client_user_id)
  where client_user_id is not null;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row
  execute function public.set_updated_at(); -- reaproveita a função de profiles.

-- client_user_id, quando presente, precisa referenciar um perfil role='client'
-- (mesmo padrão de enforce_link_client_role em provider_client_links).
create or replace function public.enforce_client_user_role()
returns trigger
language plpgsql
as $$
declare
  v_role profile_role;
begin
  if new.client_user_id is null then
    return new;
  end if;

  select role into v_role from public.profiles where user_id = new.client_user_id;
  if v_role is distinct from 'client' then
    raise exception 'PROFILE_FORBIDDEN: client_user_id must reference a client profile' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists clients_client_user_role on public.clients;
create trigger clients_client_user_role
  before insert or update of client_user_id on public.clients
  for each row
  execute function public.enforce_client_user_role();

-- Imutabilidade seletiva: tenant_id nunca muda; client_user_id só pode ir de
-- null para um valor (a "reconciliação" — ver 20260806101600), nunca ser
-- reatribuído para outra identidade depois de preenchido (regra 6 do handoff:
-- "cadastro já associado a outro client_user_id retorna conflito e nunca é
-- sobrescrito"). Igual à decisão em provider_client_links (DEC-065): RLS
-- using/with check não compara old/new, então o trigger é a barreira do
-- "o quê" pode mudar.
create or replace function public.enforce_clients_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'CLIENT_IMMUTABLE_FIELD: tenant_id cannot be changed' using errcode = '22023';
  end if;

  if old.client_user_id is not null and new.client_user_id is distinct from old.client_user_id then
    raise exception 'CLIENT_IDENTITY_ALREADY_ATTACHED: client_user_id cannot be reassigned once set' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists clients_immutable_columns on public.clients;
create trigger clients_immutable_columns
  before update on public.clients
  for each row
  execute function public.enforce_clients_immutable_columns();

alter table public.clients enable row level security;

-- Deny-by-default. Prestador proprietário do tenant lê/muta os próprios
-- clientes; a identidade associada (client_user_id) só lê o PRÓPRIO registro
-- (regra do handoff de vínculo, seção 4: "cliente lê somente os próprios
-- recursos"). Sem policy de delete: exclusão é sempre arquivamento lógico
-- (archiveClient -> status='inactive'), nunca DELETE físico pela tela.

create policy "clients_select_owner"
  on public.clients for select
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = clients.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "clients_select_self"
  on public.clients for select
  to authenticated
  using (auth.uid() = client_user_id);

create policy "clients_insert_owner"
  on public.clients for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = clients.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "clients_update_owner"
  on public.clients for update
  to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = clients.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tenants t
      where t.id = clients.tenant_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Auditoria de criação/arquivamento: reaproveita audit_creation()/
-- audit_status_change() (20260806101000/101100) — genéricas, já usadas por
-- tenants/provider_client_links/provider_link_codes, funcionam aqui porque
-- `clients` também tem colunas `id`/`tenant_id`/`status`. Nenhum dado sensível
-- (e-mail, telefone, valor) é copiado, só metadados.
drop trigger if exists clients_audit_creation on public.clients;
create trigger clients_audit_creation
  after insert on public.clients
  for each row
  execute function public.audit_creation();

drop trigger if exists clients_audit_status_change on public.clients;
create trigger clients_audit_status_change
  after update of status on public.clients
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_status_change();

-- NOTA: alterações de service_value_cents/limites/janela NÃO geram evento de
-- auditoria automático nesta etapa (só criação e mudança de status). Cobrir
-- essas mudanças exigiria um trigger dedicado que decida o que é seguro
-- registrar (nunca o valor em si teria problema, mas ainda não há decisão
-- sobre granularidade desse log); registrado como lacuna conhecida, não como
-- comportamento pretendido definitivo.

-- ============================================================================
-- Tabela client_notes — anotações internas (seção 8 do handoff)
-- ============================================================================
--
-- Conteúdo é exclusivo do prestador (regra 8 do handoff de vínculo: notas
-- nunca são visíveis ao cliente). Por isso NÃO existe policy de select/insert/
-- update/delete para a identidade associada (client_user_id) em nenhum ponto
-- desta tabela — só o proprietário do tenant do cliente referenciado.

create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  content text not null check (char_length(trim(content)) > 0),
  author_user_id uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_notes_client_idx on public.client_notes (client_id);

drop trigger if exists client_notes_set_updated_at on public.client_notes;
create trigger client_notes_set_updated_at
  before update on public.client_notes
  for each row
  execute function public.set_updated_at();

alter table public.client_notes enable row level security;

create policy "client_notes_select_owner"
  on public.client_notes for select
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_notes.client_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "client_notes_insert_owner"
  on public.client_notes for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_notes.client_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "client_notes_update_owner"
  on public.client_notes for update
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_notes.client_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_notes.client_id
        and t.owner_user_id = auth.uid()
    )
  );

create policy "client_notes_delete_owner"
  on public.client_notes for delete
  to authenticated
  using (
    exists (
      select 1 from public.clients c
      join public.tenants t on t.id = c.tenant_id
      where c.id = client_notes.client_id
        and t.owner_user_id = auth.uid()
    )
  );

-- Auditoria dedicada: cobre INSERT/UPDATE/DELETE (audit_creation/
-- audit_status_change não servem aqui — não há coluna status). Nunca copia
-- `content` (seção 8 do handoff: "conteúdo é exclusivo do prestador e nunca
-- integra... auditoria" combinado com o princípio geral de audit_events de
-- nunca reter conteúdo de observação — seção 4.8 de
-- ARQUITETURA_BACKEND_ETAPA_1.md).
create or replace function public.audit_client_note_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_resource_id uuid;
  v_client_id uuid;
  v_action text;
begin
  v_client_id := coalesce(new.client_id, old.client_id);
  v_resource_id := coalesce(new.id, old.id);

  select tenant_id into v_tenant_id from public.clients where id = v_client_id;

  if TG_OP = 'INSERT' then
    v_action := 'client_notes.created';
  elsif TG_OP = 'UPDATE' then
    v_action := 'client_notes.updated';
  else
    v_action := 'client_notes.deleted';
  end if;

  insert into public.audit_events (
    actor_user_id, tenant_id, action, resource_type, resource_id, result
  )
  values (
    auth.uid(), v_tenant_id, v_action, 'client_notes', v_resource_id, 'success'
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.audit_client_note_event() from public, anon, authenticated;

drop trigger if exists client_notes_audit_insert on public.client_notes;
create trigger client_notes_audit_insert
  after insert on public.client_notes
  for each row
  execute function public.audit_client_note_event();

drop trigger if exists client_notes_audit_update on public.client_notes;
create trigger client_notes_audit_update
  after update on public.client_notes
  for each row
  execute function public.audit_client_note_event();

drop trigger if exists client_notes_audit_delete on public.client_notes;
create trigger client_notes_audit_delete
  after delete on public.client_notes
  for each row
  execute function public.audit_client_note_event();
