-- Qualifica colunas que colidem com nomes das colunas de retorno das RPCs.
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
    E'where tenant_id = v_tenant_id\n    and status = ''active''',
    E'where provider_link_codes.tenant_id = v_tenant_id\n    and provider_link_codes.status = ''active'''
  );
  if v_patched = v_definition then
    raise exception 'rotate_provider_link_code: filtro esperado não encontrado';
  end if;
  execute v_patched;

  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'decide_provider_link_request';

  v_patched := replace(
    v_definition,
    'returning status, decided_at, decided_by',
    'returning provider_client_links.status, provider_client_links.decided_at, provider_client_links.decided_by'
  );
  if v_patched = v_definition then
    raise exception 'decide_provider_link_request: retorno esperado não encontrado';
  end if;
  execute v_patched;
end
$$;
