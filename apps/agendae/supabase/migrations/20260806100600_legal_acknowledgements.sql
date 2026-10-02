-- Etapa 1 — legal_acknowledgements (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.6).
-- Registro imutável: aceite dos Termos e ciência da Política são eventos
-- separados, nunca modelados como consentimento opcional.
-- Referencia auth.users diretamente (não public.profiles) porque o aceite
-- pode ocorrer no mesmo passo da criação do perfil, sem depender de qual
-- linha é gravada primeiro.

create table if not exists public.legal_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.legal_documents (id),
  action legal_ack_action not null,
  occurred_at timestamptz not null default now(),
  source app_platform not null
);

create index if not exists legal_acknowledgements_user_idx on public.legal_acknowledgements (user_id);

alter table public.legal_acknowledgements enable row level security;

create policy "legal_acknowledgements_select_self"
  on public.legal_acknowledgements for select
  to authenticated
  using (auth.uid() = user_id);

create policy "legal_acknowledgements_insert_self"
  on public.legal_acknowledgements for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Sem policy de update/delete: trilha de aceite é append-only.
