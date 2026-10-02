-- Auditoria executável da correção do advisor 0008 (rls_enabled_no_policy).
do $$
declare
  v_rls boolean;
  v_policy_count integer;
  v_can_select boolean;
  v_tables text[] := array[
    'audit_events',
    'manual_payments_value_history',
    'notification_push_deliveries',
    'push_dispatch_config',
    'subscription_finalization_config',
    'subscription_idempotency_keys'
  ];
  v_table text;
begin
  foreach v_table in array v_tables loop
    -- RLS precisa continuar habilitada em todas as seis.
    select c.relrowsecurity
      into v_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;
    assert v_rls, format('%I deve ter RLS habilitado', v_table);

    -- Cada tabela precisa ter ao menos uma policy registrada (o achado do
    -- advisor 0008 é justamente RLS habilitada sem nenhuma policy).
    select count(*)
      into v_policy_count
    from pg_policies
    where schemaname = 'public' and tablename = v_table;
    assert v_policy_count > 0,
      format('%I deve ter ao menos uma policy explícita', v_table);

    -- Nenhuma das seis pode conceder select/insert/update/delete a
    -- anon/authenticated: o acesso legítimo é só service_role/SECURITY DEFINER.
    select has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT')
        or has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
        or has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
        or has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE')
      into v_can_select;
    assert not v_can_select,
      format('%I não pode conceder privilégios de tabela a anon/authenticated', v_table);
  end loop;

  -- As policies desta migration são deliberadamente "deny all" para
  -- anon/authenticated (using false / with check false) nas seis tabelas —
  -- confirma que nenhuma ficou aberta por engano com using(true).
  assert not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(v_tables)
      and (qual is null or lower(qual) not like '%false%')
  ), 'toda policy destas seis tabelas deve negar explicitamente com using (false)';

  -- service_role continua liberado para as duas tabelas de segredo de cron
  -- (push_dispatch_config / subscription_finalization_config), pois é quem
  -- as Edge Functions usam para ler o segredo assinado no header do cron.
  assert has_table_privilege('service_role', 'public.push_dispatch_config', 'SELECT'),
    'service_role deve conseguir ler push_dispatch_config';
  assert has_table_privilege('service_role', 'public.subscription_finalization_config', 'SELECT'),
    'service_role deve conseguir ler subscription_finalization_config';
end;
$$;
