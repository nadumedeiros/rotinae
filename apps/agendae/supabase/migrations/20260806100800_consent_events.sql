-- Etapa 1 — consent_events (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.7).
-- Trilha append-only: cada alteração de preferência gera um evento imutável;
-- communication_preferences é a projeção do último evento válido.

create table if not exists public.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  channel consent_channel not null,
  purpose text not null check (char_length(trim(purpose)) > 0),
  action consent_action not null,
  notice_version text not null,
  occurred_at timestamptz not null default now(),
  source app_platform not null,
  correlation_id uuid
);

create index if not exists consent_events_user_idx on public.consent_events (user_id);

alter table public.consent_events enable row level security;

create policy "consent_events_select_self"
  on public.consent_events for select
  to authenticated
  using (auth.uid() = user_id);

create policy "consent_events_insert_self"
  on public.consent_events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Sem policy de update/delete: "histórico de eventos não é editável por
-- usuários comuns" (seção 4.7).
