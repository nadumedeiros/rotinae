-- Corrige os advisors 0002/0010 sem alterar os contratos consumidos pelo app.
-- Dados de auth.users deixam de ser dependência de qualquer view exposta.

create table if not exists public.account_contact_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Usuário',
  email text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.account_contact_directory enable row level security;

drop policy if exists "account_contact_directory_select_self" on public.account_contact_directory;
create policy "account_contact_directory_select_self"
  on public.account_contact_directory for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "account_contact_directory_select_pending_provider" on public.account_contact_directory;
create policy "account_contact_directory_select_pending_provider"
  on public.account_contact_directory for select
  to authenticated
  using (
    exists (
      select 1
      from public.provider_client_links link
      join public.tenants tenant on tenant.id = link.tenant_id
      where link.client_user_id = account_contact_directory.user_id
        and link.status = 'pending'
        and tenant.owner_user_id = (select auth.uid())
    )
  );

revoke all on public.account_contact_directory from public, anon;
grant select on public.account_contact_directory to authenticated;

insert into public.account_contact_directory (user_id, display_name, email, updated_at)
select
  profile.user_id,
  profile.display_name,
  coalesce(auth_user.email, ''),
  greatest(profile.updated_at, auth_user.updated_at)
from public.profiles profile
join auth.users auth_user on auth_user.id = profile.user_id
on conflict (user_id) do update
set display_name = excluded.display_name,
    email = excluded.email,
    updated_at = excluded.updated_at;

create or replace function public.sync_account_contact_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_contact_directory (user_id, display_name, email, updated_at)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Usuário'),
    coalesce(new.email, ''),
    now()
  )
  on conflict (user_id) do update
  set email = excluded.email,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_account_contact_from_auth() from public, anon, authenticated;

drop trigger if exists auth_users_sync_account_contact on auth.users;
create trigger auth_users_sync_account_contact
  after insert or update of email on auth.users
  for each row execute function public.sync_account_contact_from_auth();

create or replace function public.sync_account_contact_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_contact_directory (user_id, display_name, email, updated_at)
  values (new.user_id, new.display_name, '', now())
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_account_contact_from_profile() from public, anon, authenticated;

drop trigger if exists profiles_sync_account_contact on public.profiles;
create trigger profiles_sync_account_contact
  after insert or update of display_name on public.profiles
  for each row execute function public.sync_account_contact_from_profile();

create or replace view public.provider_pending_link_requests
with (security_invoker = true)
as
select
  link.id,
  link.tenant_id,
  link.client_user_id,
  directory.display_name as client_name,
  directory.email::varchar(255) as client_email,
  link.requested_at
from public.provider_client_links link
join public.tenants tenant on tenant.id = link.tenant_id
join public.account_contact_directory directory on directory.user_id = link.client_user_id
where link.status = 'pending'
  and tenant.owner_user_id = (select auth.uid());

revoke all on public.provider_pending_link_requests from public, anon;
grant select on public.provider_pending_link_requests to authenticated;

drop policy if exists "appointments_select_client_self" on public.appointments;
create policy "appointments_select_client_self"
  on public.appointments for select
  to authenticated
  using (
    exists (
      select 1
      from public.clients client
      where client.id = appointments.client_id
        and client.client_user_id = (select auth.uid())
    )
  );

alter view public.appointments_client_view set (security_invoker = true);

notify pgrst, 'reload schema';
