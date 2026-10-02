-- Etapa 1 — audit_events (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.8).
-- Nunca grava código completo, token, conteúdo de observação, arquivo,
-- documento pessoal ou payload financeiro completo (seção 4.8).
--
-- Matriz de acesso (seção 3.2): "Auditoria técnica" é "Sem CRUD direto" para
-- Prestador e Cliente. Por isso esta tabela NÃO recebe nenhuma policy para
-- anon/authenticated — RLS habilitada + zero policies = acesso negado por
-- completo a esses papéis. Escrita e leitura administrativa acontecem via
-- service_role ou função SECURITY DEFINER dedicada, nunca pela app.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id),
  tenant_id uuid references public.tenants (id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  occurred_at timestamptz not null default now(),
  result text not null check (result in ('success', 'failure')),
  correlation_id uuid
);

create index if not exists audit_events_tenant_idx on public.audit_events (tenant_id);
create index if not exists audit_events_actor_idx on public.audit_events (actor_user_id);
create index if not exists audit_events_occurred_idx on public.audit_events (occurred_at);

alter table public.audit_events enable row level security;
-- Nenhuma policy adicionada de propósito (ver comentário acima).
