-- Prevent self-service account reactivation and require an active admin profile.

create or replace function public.enforce_profile_status_immutable_by_owner()
returns trigger
language plpgsql
set search_path = public, auth
as $$
begin
  if new.status is distinct from old.status
    and coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'PROFILE_STATUS_FORBIDDEN: status only changes via service_role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_status_immutable_by_owner on public.profiles;
create trigger profiles_status_immutable_by_owner
  before update of status on public.profiles
  for each row
  execute function public.enforce_profile_status_immutable_by_owner();

create or replace function public.assert_active_admin()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and is_admin = true
      and status = 'active'
  ) then
    raise exception 'ADMIN_FORBIDDEN: active administrator required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_active_admin() from public, anon, authenticated;

alter function public.get_admin_users() rename to get_admin_users_unchecked;
revoke all on function public.get_admin_users_unchecked() from public, anon, authenticated;

create function public.get_admin_users()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_active_admin();
  return public.get_admin_users_unchecked();
end;
$$;

alter function public.admin_set_provider_plan(uuid, text) rename to admin_set_provider_plan_unchecked;
revoke all on function public.admin_set_provider_plan_unchecked(uuid, text) from public, anon, authenticated;

create function public.admin_set_provider_plan(target_user_id uuid, target_plan text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.assert_active_admin();
  perform public.admin_set_provider_plan_unchecked(target_user_id, target_plan);
end;
$$;

grant execute on function public.get_admin_users() to authenticated;
grant execute on function public.admin_set_provider_plan(uuid, text) to authenticated;
