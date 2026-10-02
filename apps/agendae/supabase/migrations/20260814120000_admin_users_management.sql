-- ============================================================================
-- Gestão Administrativa de Usuários (Painel Admin) — Corrigido
-- ============================================================================
-- RPCs protegidas por verificação da flag `public.profiles.is_admin = true`.
-- Lista 100% dos usuários do Supabase com tratamento dos enums exatos do schema.

create or replace function public.get_admin_users()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_caller_admin boolean;
  result jsonb;
begin
  -- 1. Verificação de administrador
  select coalesce(is_admin, false) into is_caller_admin
  from public.profiles
  where user_id = auth.uid();

  if not is_caller_admin then
    raise exception 'ADMIN_FORBIDDEN: caller is not an administrator' using errcode = '42501';
  end if;

  -- 2. Agregações com os enums exatos do schema
  with user_roles_agg as (
    select
      user_id,
      array_agg(role order by role) as roles
    from public.profile_roles
    group by user_id
  ),
  latest_terms as (
    select distinct on (la.user_id)
      la.user_id,
      la.occurred_at,
      la.source,
      ld.version as terms_version
    from public.legal_acknowledgements la
    join public.legal_documents ld on ld.id = la.document_id
    where ld.kind = 'terms' and la.action = 'accepted_terms'
    order by la.user_id, la.occurred_at desc
  ),
  latest_privacy as (
    select distinct on (la.user_id)
      la.user_id,
      ld.version as privacy_version
    from public.legal_acknowledgements la
    join public.legal_documents ld on ld.id = la.document_id
    where ld.kind = 'privacy_policy' and la.action = 'acknowledged_privacy'
    order by la.user_id, la.occurred_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'name', coalesce(
          nullif(p.display_name, ''),
          nullif(u.raw_user_meta_data->>'name', ''),
          nullif(u.raw_user_meta_data->>'full_name', ''),
          split_part(u.email, '@', 1)
        ),
        'email', coalesce(u.email, ''),
        'phone', coalesce(
          nullif(p.phone, ''),
          nullif(u.raw_user_meta_data->>'phone', ''),
          nullif(u.phone, ''),
          ''
        ),
        'profile', case
          when 'client' = any(ura.roles) and 'provider' = any(ura.roles)
            then 'Cliente e prestador'
          when 'provider' = any(ura.roles)
            or p.role = 'provider'
            or u.raw_user_meta_data->>'role' = 'provider'
            then 'Prestador'
          else 'Cliente'
        end,
        'plan', case
          when ps.status in ('active', 'trialing') then 'premium'
          else 'free'
        end,
        'status', case
          when u.banned_until is not null and u.banned_until > now() then 'Inativo'
          else 'Ativo'
        end,
        'createdAt', coalesce(to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'lastAccess', coalesce(to_char(u.last_sign_in_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'termsAccepted', (lt.occurred_at is not null),
        'termsAcceptedAt', to_char(lt.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'termsVersion', lt.terms_version,
        'privacyVersion', lp.privacy_version,
        'consentSource', coalesce(lt.source::text, u.raw_user_meta_data->>'source', 'web')
      )
      order by u.created_at desc
    ),
    '[]'::jsonb
  ) into result
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join user_roles_agg ura on ura.user_id = u.id
  left join public.provider_subscriptions ps on ps.provider_user_id = u.id
  left join latest_terms lt on lt.user_id = u.id
  left join latest_privacy lp on lp.user_id = u.id
  where u.deleted_at is null;

  return result;
end;
$$;

create or replace function public.admin_set_provider_plan(
  target_user_id uuid,
  target_plan text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_caller_admin boolean;
  new_status text;
  v_display_name text;
  v_email text;
begin
  -- 1. Validação de administrador
  select coalesce(is_admin, false) into is_caller_admin
  from public.profiles
  where user_id = auth.uid();

  if not is_caller_admin then
    raise exception 'ADMIN_FORBIDDEN: caller is not an administrator' using errcode = '42501';
  end if;

  -- 2. Validação do plano solicitado
  if target_plan not in ('free', 'premium') then
    raise exception 'INVALID_PLAN: plan must be free or premium' using errcode = '22023';
  end if;

  new_status := case when target_plan = 'premium' then 'active' else 'free' end;

  -- 3. Assegura que a linha em public.profiles e profile_roles existe para o prestador
  select email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
  into v_email, v_display_name
  from auth.users
  where id = target_user_id;

  insert into public.profiles (
    user_id,
    display_name,
    role,
    is_admin
  ) values (
    target_user_id,
    coalesce(v_display_name, 'Prestador'),
    'provider',
    false
  )
  on conflict (user_id) do nothing;

  insert into public.profile_roles (
    user_id,
    role
  ) values (
    target_user_id,
    'provider'
  )
  on conflict (user_id, role) do nothing;

  -- 4. Upsert na tabela provider_subscriptions
  insert into public.provider_subscriptions (
    provider_user_id,
    status,
    updated_at
  ) values (
    target_user_id,
    new_status,
    now()
  )
  on conflict (provider_user_id)
  do update set
    status = excluded.status,
    updated_at = now();
end;
$$;

-- Permissões de execução
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_plan(uuid, text) TO authenticated;
