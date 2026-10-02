-- Auditoria executável da correção dos advisors 0002 e 0010.
do $$
declare
  v_options text[];
  v_definition text;
  v_rls boolean;
  v_public_execute boolean;
begin
  select c.reloptions
    into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'provider_pending_link_requests';
  assert 'security_invoker=true' = any(coalesce(v_options, array[]::text[])),
    'provider_pending_link_requests deve ser security_invoker';

  select pg_get_viewdef('public.provider_pending_link_requests'::regclass, true)
    into v_definition;
  assert position('auth.users' in lower(v_definition)) = 0,
    'provider_pending_link_requests não pode depender de auth.users';
  assert position('account_contact_directory' in lower(v_definition)) > 0,
    'provider_pending_link_requests deve usar o diretório protegido';

  select c.reloptions
    into v_options
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'appointments_client_view';
  assert 'security_invoker=true' = any(coalesce(v_options, array[]::text[])),
    'appointments_client_view deve ser security_invoker';

  select c.relrowsecurity
    into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'account_contact_directory';
  assert v_rls, 'account_contact_directory deve ter RLS habilitado';

  assert exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'appointments'
      and policyname = 'appointments_select_client_self'
  ), 'policy de leitura do próprio agendamento deve existir';

  select has_function_privilege('anon', 'public.sync_account_contact_from_auth()', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.sync_account_contact_from_auth()', 'EXECUTE')
    into v_public_execute;
  assert not v_public_execute,
    'função interna de sincronização auth não pode ter EXECUTE público';

  select has_function_privilege('anon', 'public.sync_account_contact_from_profile()', 'EXECUTE')
      or has_function_privilege('authenticated', 'public.sync_account_contact_from_profile()', 'EXECUTE')
    into v_public_execute;
  assert not v_public_execute,
    'função interna de sincronização profile não pode ter EXECUTE público';
end;
$$;
