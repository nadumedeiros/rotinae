-- Corrige erros e avisos encontrados por `supabase db lint --linked` em
-- 2026-08-10. As funções já existem em migrations anteriores; transformar a
-- definição instalada preserva assinaturas, grants e regras de negócio.

do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rotate_provider_link_code';

  v_patched := replace(
    v_definition,
    'encode(gen_random_bytes(16), ''hex'')',
    'encode(extensions.gen_random_bytes(16), ''hex'')'
  );
  if v_patched = v_definition then
    raise exception 'rotate_provider_link_code: trecho esperado não encontrado';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'revoke_provider_client_link';

  v_patched := replace(
    v_definition,
    'returning status, revoked_at, revoked_by',
    'returning provider_client_links.status, provider_client_links.revoked_at, provider_client_links.revoked_by'
  );
  if v_patched = v_definition then
    raise exception 'revoke_provider_client_link: trecho esperado não encontrado';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'decide_provider_link_request';

  v_patched := replace(
    v_definition,
    'where id = target_client_id',
    'where public.clients.id = target_client_id'
  );
  if v_patched = v_definition then
    raise exception 'decide_provider_link_request: trecho esperado não encontrado';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'next_business_day';

  v_patched := replace(v_definition, E'  end loop;\nend;', E'  end loop;\n  return null;\nend;');
  if v_patched = v_definition then
    raise exception 'next_business_day: trecho esperado não encontrado';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_recurring_appointments';

  v_patched := replace(v_definition, E'  i integer;\n', '');
  if v_patched = v_definition then
    raise exception 'create_recurring_appointments: variável esperada não encontrada';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_appointment';

  v_patched := replace(v_definition, E'  v_client_total_limit integer;\n', '');
  v_patched := replace(
    v_patched,
    'c.client_user_id, c.total_booking_limit, c.daily_booking_limit',
    'c.client_user_id, c.daily_booking_limit'
  );
  v_patched := replace(
    v_patched,
    'v_client_user_id, v_client_total_limit, v_client_daily_limit',
    'v_client_user_id, v_client_daily_limit'
  );
  if v_patched = v_definition then
    raise exception 'update_appointment: variável esperada não encontrada';
  end if;
  execute v_patched;
end
$$;
