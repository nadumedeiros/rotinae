-- Uma identidade pode possuir os perfis Cliente e Prestador, mantendo um
-- único contexto ativo por vez. `profiles.role` permanece como espelho do
-- contexto ativo para compatibilidade com as RLS/RPCs existentes.

create table if not exists public.profile_roles (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role profile_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.profile_roles enable row level security;

create policy "profile_roles_select_self"
  on public.profile_roles for select
  to authenticated
  using (auth.uid() = user_id);

insert into public.profile_roles (user_id, role)
select user_id, role from public.profiles
on conflict (user_id, role) do nothing;

-- Invariantes estruturais passam a consultar a associação de papéis, não o
-- contexto ativo espelhado em profiles.role.
create or replace function public.enforce_tenant_owner_is_provider()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profile_roles
    where user_id = new.owner_user_id and role = 'provider'
  ) then
    raise exception 'PROFILE_FORBIDDEN: owner_user_id must reference a provider profile' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_link_client_role()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.profile_roles
    where user_id = new.client_user_id and role = 'client'
  ) then
    raise exception 'PROFILE_FORBIDDEN: client_user_id must reference a client profile' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_client_user_role()
returns trigger
language plpgsql
as $$
begin
  if new.client_user_id is not null and not exists (
    select 1 from public.profile_roles
    where user_id = new.client_user_id and role = 'client'
  ) then
    raise exception 'PROFILE_FORBIDDEN: client_user_id must reference a client profile' using errcode = '22023';
  end if;
  return new;
end;
$$;

alter table public.profiles add column if not exists active_role profile_role;
update public.profiles set active_role = role where active_role is null;
alter table public.profiles alter column active_role set not null;

create or replace function public.set_initial_active_profile_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.active_role := coalesce(new.active_role, new.role);
  return new;
end;
$$;

drop trigger if exists profiles_set_initial_active_role on public.profiles;
create trigger profiles_set_initial_active_role
  before insert on public.profiles
  for each row execute function public.set_initial_active_profile_role();

create or replace function public.provision_initial_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profile_roles (user_id, role)
  values (new.user_id, new.role)
  on conflict (user_id, role) do nothing;
  if new.role = 'provider' then
    insert into public.tenants (owner_user_id, display_name, timezone)
    values (new.user_id, new.display_name, 'America/Sao_Paulo')
    on conflict (owner_user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_provision_initial_role on public.profiles;
create trigger profiles_provision_initial_role
  after insert on public.profiles
  for each row execute function public.provision_initial_profile_role();

drop trigger if exists profiles_role_immutable on public.profiles;
drop function if exists public.enforce_profile_role_immutable();

create or replace function public.protect_active_profile_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from new.active_role then
    raise exception 'PROFILE_ROLE_CONTEXT_MISMATCH' using errcode = '22023';
  end if;
  if (new.role is distinct from old.role or new.active_role is distinct from old.active_role)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'PROFILE_ROLE_WRITE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_active_role
  before update of role, active_role on public.profiles
  for each row execute function public.protect_active_profile_role();

create or replace function public.add_profile_role(p_role profile_role)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SESSION_EXPIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = v_user_id and status = 'active') then
    raise exception 'ACCOUNT_DISABLED' using errcode = '42501';
  end if;
  insert into public.profile_roles (user_id, role)
  values (v_user_id, p_role)
  on conflict (user_id, role) do nothing;
  if p_role = 'provider' then
    insert into public.tenants (owner_user_id, display_name, timezone)
    select user_id, display_name, 'America/Sao_Paulo'
    from public.profiles where user_id = v_user_id
    on conflict (owner_user_id) do nothing;
  end if;
end;
$$;

create or replace function public.switch_profile_role(p_role profile_role)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'SESSION_EXPIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profile_roles
    where user_id = v_user_id and role = p_role
  ) then
    raise exception 'ROLE_NOT_AVAILABLE' using errcode = '22023';
  end if;
  update public.profiles
  set role = p_role, active_role = p_role
  where user_id = v_user_id and status = 'active';
  if not found then
    raise exception 'ACCOUNT_DISABLED' using errcode = '42501';
  end if;

  -- Um contexto Prestador sem tenant quebra todas as portas tenant-scoped
  -- (Dashboard, Agenda, Clientes e Financeiro). O provisionamento acontece
  -- depois de `profiles.role` virar provider para satisfazer
  -- `enforce_tenant_owner_is_provider`, e é idempotente pela UNIQUE de
  -- `tenants.owner_user_id`.
  if p_role = 'provider' then
    insert into public.tenants (owner_user_id, display_name, timezone, status)
    select p.user_id, p.display_name, 'America/Sao_Paulo', 'active'
    from public.profiles p
    where p.user_id = v_user_id
    on conflict (owner_user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.add_profile_role(profile_role) from public, anon;
revoke all on function public.switch_profile_role(profile_role) from public, anon;
grant execute on function public.add_profile_role(profile_role) to authenticated;
grant execute on function public.switch_profile_role(profile_role) to authenticated;

-- Corrige identidades Prestador preexistentes que tenham sido criadas antes
-- de existir um fluxo transacional de provisionamento de tenant. Perfis que
-- apenas POSSUEM o papel Prestador, mas estão no contexto Cliente, serão
-- provisionados ao efetivamente chamar `switch_profile_role('provider')`.
insert into public.tenants (owner_user_id, display_name, timezone, status)
select p.user_id, p.display_name, 'America/Sao_Paulo', 'active'
from public.profiles p
where p.status = 'active'
  and p.role = 'provider'
on conflict (owner_user_id) do nothing;

-- Corrige prestadores preexistentes que ainda não possuam tenant operacional.
insert into public.tenants (owner_user_id, display_name, timezone)
select p.user_id, p.display_name, 'America/Sao_Paulo'
from public.profiles p
join public.profile_roles pr on pr.user_id = p.user_id and pr.role = 'provider'
where not exists (select 1 from public.tenants t where t.owner_user_id = p.user_id)
on conflict (owner_user_id) do nothing;
