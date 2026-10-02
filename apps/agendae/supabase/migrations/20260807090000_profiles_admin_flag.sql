-- Etapa 1 — extensão aditiva de profiles (DEC-076): suporte real a `isAdmin`
-- no schema, hoje hardcoded como `false` em `SupabaseAuthAdapter.toSession`
-- (comentário removido nesse mesmo commit) por falta desta coluna. Sem isso,
-- migrar `admin-users.tsx`/`index.tsx` do `MockAuthAdapter` para o adapter
-- real tornaria o painel administrativo permanentemente inacessível.
--
-- Coluna nula? Não — `not null default false`: toda linha existente de
-- `profiles` passa a ter `is_admin = false` sem exigir backfill nem quebrar
-- nenhuma leitura existente (RLS de `profiles` não muda: select/insert
-- continuam abertos ao próprio dono da linha, a nova coluna é só mais um
-- campo da mesma linha, sujeito às mesmas policies).
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ============================================================================
-- Achado de segurança (mesma classe de DEC-065): "quem pode dar UPDATE" e "o
-- que pode ser alterado nesse UPDATE" são perguntas diferentes.
-- ============================================================================
--
-- A policy "profiles_update_self" (20260806100100_profiles.sql) autoriza o
-- próprio usuário autenticado a dar UPDATE em QUALQUER coluna da própria
-- linha — RLS avalia por linha (`auth.uid() = user_id`), não por coluna. Sem
-- proteção adicional, um UPDATE comum via REST (`PATCH /profiles?user_id=eq.<self>`
-- com `{ is_admin: true }`) bastaria para o próprio usuário se autopromover a
-- administrador. `using`/`with check` de RLS não resolvem isso: nenhuma das
-- duas cláusulas tem acesso ao valor ANTIGO (`old`) da linha para comparar
-- coluna a coluna com o valor novo — só veem a linha candidata no momento da
-- avaliação. A forma idiomática em Postgres para essa comparação é um trigger
-- `before update`, que roda com `old`/`new` disponíveis e pode `raise
-- exception` para abortar a transação. Mesmo padrão de
-- `enforce_provider_client_links_immutable_columns` (DEC-065) e
-- `enforce_profile_role_immutable` (já existente nesta mesma tabela).
--
-- Diferença deste caso para os dois anteriores: `role` e as colunas de
-- `provider_client_links` cobertas por DEC-065 são imutáveis para QUALQUER
-- executor, sem exceção. `is_admin` precisa de uma via administrativa direta
-- (SQL/dashboard/service_role) para alguém eventualmente ser promovido — do
-- contrário a coluna nasceria permanentemente `false` para todo mundo, o
-- mesmo problema que esta migration existe para resolver. `auth.role()` é a
-- função do schema `auth` (parte do Supabase Auth, já usada implicitamente
-- por `auth.uid()` nas policies desta tabela) que expõe o papel Postgres
-- efetivo da conexão atual; quando a API é chamada com a service key, o
-- PostgREST troca para o role `service_role` antes de executar a query — que
-- NÃO tem policy própria nesta tabela e por isso ignora RLS por completo
-- (é a mesma via já usada para operações administrativas em
-- `legal_documents`/`audit_events`), mas ainda passa pelos triggers, que são
-- independentes de RLS. Por isso o trigger abaixo, e não a policy, é o lugar
-- certo para abrir essa exceção: permite ao service_role alterar `is_admin`
-- livremente, e bloqueia qualquer outra via (`authenticated`, `anon`) com
-- `raise exception` + `errcode = '42501'` (insuficiência de privilégio — o
-- mesmo código já mapeado para `FORBIDDEN` pelos adapters do projeto, ver
-- `supabase-client-portfolio-adapter.ts`/`supabase-service-catalog-adapter.ts`).
create or replace function public.enforce_profiles_admin_flag_immutable_by_owner()
returns trigger
language plpgsql
as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.role() <> 'service_role' then
    raise exception 'PROFILE_ADMIN_FLAG_FORBIDDEN: is_admin only changes via service_role' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_admin_flag_immutable_by_owner on public.profiles;
create trigger profiles_admin_flag_immutable_by_owner
  before update on public.profiles
  for each row
  execute function public.enforce_profiles_admin_flag_immutable_by_owner();

-- ============================================================================
-- Auditoria: escalada de privilégio é sensível por definição (mesmo raciocínio
-- de `audit_service_field_change`, DEC-071 — reaproveita o mecanismo já
-- existente em vez de inventar um novo). Dedicada porque `audit_status_change`
-- /`audit_creation` (20260806101000/101100) leem `to_jsonb(new)->>'id'`, e
-- `profiles` não tem coluna `id` (chave primária é `user_id`); e porque
-- `profiles` não tem `tenant_id` — diferente de `services`/`tenants`, aqui não
-- existe um tenant para associar ao evento, então a coluna fica `null`
-- (nullable em `audit_events`, sem violar a FK para `tenants`).
create or replace function public.audit_profile_admin_flag_change()
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
    auth.uid(),
    null,
    'profiles.is_admin: ' || old.is_admin::text || ' -> ' || new.is_admin::text,
    'profiles',
    new.user_id,
    'success'
  );

  return new;
end;
$$;

revoke all on function public.audit_profile_admin_flag_change() from public, anon, authenticated;

drop trigger if exists profiles_audit_admin_flag_change on public.profiles;
create trigger profiles_audit_admin_flag_change
  after update of is_admin on public.profiles
  for each row
  when (old.is_admin is distinct from new.is_admin)
  execute function public.audit_profile_admin_flag_change();
