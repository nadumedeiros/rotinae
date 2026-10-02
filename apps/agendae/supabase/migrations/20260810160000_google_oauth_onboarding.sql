-- Permite que identidades Google sejam criadas pelo GoTrue antes de o usuário
-- concluir papel e consentimentos. O perfil operacional continua bloqueado
-- até a RPC transacional abaixo concluir todo o onboarding.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role profile_role;
  v_name text;
  v_phone text;
  v_consent_version text;
  v_marketing text;
  v_source app_platform;
  v_terms_doc uuid;
  v_privacy_doc uuid;
begin
  -- OAuth não transporta metadados jurídicos arbitrários no primeiro insert.
  -- A identidade fica sem `profiles` e, portanto, sem acesso operacional,
  -- até `complete_google_oauth_onboarding` ser executada pela própria sessão.
  if new.raw_app_meta_data->>'provider' = 'google'
     and new.raw_user_meta_data->>'role' is null then
    return new;
  end if;

  v_name := new.raw_user_meta_data->>'name';
  v_phone := new.raw_user_meta_data->>'phone';
  v_consent_version := new.raw_user_meta_data->>'consentVersion';
  v_marketing := new.raw_user_meta_data->>'marketingConsent';
  v_source := coalesce((new.raw_user_meta_data->>'source')::app_platform, 'web');

  if new.raw_user_meta_data->>'role' is null then
    raise exception 'SIGNUP_METADATA_MISSING: role is required' using errcode = '22023';
  end if;
  v_role := (new.raw_user_meta_data->>'role')::profile_role;

  if v_name is null or length(trim(v_name)) = 0 then
    raise exception 'SIGNUP_METADATA_MISSING: name is required' using errcode = '22023';
  end if;
  if v_consent_version is null or length(trim(v_consent_version)) = 0 then
    raise exception 'SIGNUP_METADATA_MISSING: consentVersion is required' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, role, display_name, phone)
  values (new.id, v_role, trim(v_name), v_phone);

  select id into v_terms_doc from public.legal_documents
  where kind = 'terms' and version = v_consent_version and status = 'active';
  select id into v_privacy_doc from public.legal_documents
  where kind = 'privacy_policy' and version = v_consent_version and status = 'active';

  if v_terms_doc is null or v_privacy_doc is null then
    raise exception 'LEGAL_DOCUMENT_NOT_FOUND: active documents version % required', v_consent_version
      using errcode = '22023';
  end if;

  insert into public.legal_acknowledgements (user_id, document_id, action, source)
  values
    (new.id, v_terms_doc, 'accepted_terms', v_source),
    (new.id, v_privacy_doc, 'acknowledged_privacy', v_source);

  if v_marketing = 'true' then
    insert into public.consent_events (user_id, channel, purpose, action, notice_version, source)
    values (new.id, 'email', 'marketing', 'granted', v_consent_version, v_source);
  end if;
  return new;
end;
$$;

create or replace function public.complete_google_oauth_onboarding(
  p_role profile_role,
  p_consent_version text,
  p_source app_platform
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user auth.users%rowtype;
  v_name text;
  v_terms_doc uuid;
  v_privacy_doc uuid;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then
    raise exception 'SESSION_EXPIRED' using errcode = '42501';
  end if;
  if not (coalesce(v_user.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google') then
    raise exception 'OAUTH_PROVIDER_INVALID' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where user_id = v_user.id) then
    return;
  end if;

  select id into v_terms_doc from public.legal_documents
  where kind = 'terms' and version = p_consent_version and status = 'active';
  select id into v_privacy_doc from public.legal_documents
  where kind = 'privacy_policy' and version = p_consent_version and status = 'active';
  if v_terms_doc is null or v_privacy_doc is null then
    raise exception 'LEGAL_DOCUMENT_NOT_FOUND' using errcode = '22023';
  end if;

  v_name := coalesce(
    nullif(trim(v_user.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(v_user.raw_user_meta_data->>'name'), ''),
    split_part(v_user.email, '@', 1)
  );

  insert into public.profiles (user_id, role, display_name)
  values (v_user.id, p_role, v_name);
  insert into public.legal_acknowledgements (user_id, document_id, action, source)
  values
    (v_user.id, v_terms_doc, 'accepted_terms', p_source),
    (v_user.id, v_privacy_doc, 'acknowledged_privacy', p_source);
end;
$$;

revoke all on function public.complete_google_oauth_onboarding(profile_role, text, app_platform)
  from public, anon;
grant execute on function public.complete_google_oauth_onboarding(profile_role, text, app_platform)
  to authenticated;
