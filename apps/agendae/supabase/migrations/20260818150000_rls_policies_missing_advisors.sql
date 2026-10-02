-- Corrige o advisor 0008 (rls_enabled_no_policy, INFO/SECURITY):
-- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
--
-- As seis tabelas abaixo já tinham RLS habilitada, mas nenhuma POLICY
-- registrada em pg_policies. Na prática isso já bloqueava totalmente
-- `anon`/`authenticated` (RLS habilitada + zero policies = nega tudo), então
-- não há mudança de comportamento aqui — apenas formalização explícita da
-- intenção via policy, para que o advisor pare de reportar o achado e para
-- que a ausência de acesso client-side fique documentada no próprio catálogo
-- (pg_policies), não só em comentário de migration.
--
-- Investigação feita antes desta migration (grep completo em
-- apps/agendae/src e apps/agendae/supabase/functions) confirmou que nenhuma
-- das seis tabelas é lida ou escrita pelo app autenticado (browser/mobile):
--
--   - audit_events: já documentada em 20260806100900 como "sem CRUD direto"
--     (matriz de acesso, seção 3.2 da arquitetura). Escrita só via triggers
--     SECURITY DEFINER (audit_status_change/audit_creation/audit_payment_mutation).
--   - manual_payments_value_history: já documentada em 20260811120000 como
--     apêndice de auditoria, escrita só via audit_payment_mutation()
--     (SECURITY DEFINER). Nenhuma referência em apps/agendae/src.
--   - notification_push_deliveries: fila operacional, lida/escrita só pela
--     Edge Function send-push-notifications via client `admin`
--     (SUPABASE_SERVICE_ROLE_KEY) e pela RPC claim_notification_push_deliveries
--     (EXECUTE concedido só a service_role). Nenhuma referência em
--     apps/agendae/src.
--   - push_dispatch_config: já revogada de public/anon/authenticated e
--     concedida só a service_role em 20260811160000; faltava apenas a policy.
--   - subscription_finalization_config: mesmo padrão, já revogada/concedida
--     em 20260811162000 (só service_role); faltava apenas a policy.
--   - subscription_idempotency_keys: lida/escrita só pela Edge Function
--     mercado-pago-subscriptions via client `admin` (service role).
--     Nenhuma referência em apps/agendae/src.
--
-- Conclusão: as seis são de uso exclusivamente interno (service_role e/ou
-- funções SECURITY DEFINER, que rodam com o privilégio do dono da função,
-- não do papel `authenticated`). Nenhuma delas tem hoje um caso de uso
-- legítimo de leitura própria pelo cliente (ex.: "ver meu próprio histórico
-- de pagamento" ou "ver minhas próprias entregas de push" não existem na UI
-- atual), então a policy correta é negar explicitamente `anon`/`authenticated`
-- em vez de abrir acesso especulativo (YAGNI). Se um caso de uso desses
-- surgir no futuro, a policy restritiva abaixo deve ser substituída por uma
-- policy de select escopada ao dono do dado — nunca apenas removida.

-- ============================================================================
-- audit_events
-- ============================================================================
revoke all on public.audit_events from public, anon, authenticated;

drop policy if exists "audit_events_deny_client_access" on public.audit_events;
create policy "audit_events_deny_client_access"
  on public.audit_events for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- manual_payments_value_history
-- ============================================================================
revoke all on public.manual_payments_value_history from public, anon, authenticated;

drop policy if exists "manual_payments_value_history_deny_client_access" on public.manual_payments_value_history;
create policy "manual_payments_value_history_deny_client_access"
  on public.manual_payments_value_history for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- notification_push_deliveries
-- ============================================================================
revoke all on public.notification_push_deliveries from public, anon, authenticated;

drop policy if exists "notification_push_deliveries_deny_client_access" on public.notification_push_deliveries;
create policy "notification_push_deliveries_deny_client_access"
  on public.notification_push_deliveries for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- push_dispatch_config
-- ============================================================================
-- Privilégios de tabela já revogados/concedidos em 20260811160000
-- (revoke all from public/anon/authenticated; grant select to service_role).
-- Faltava só a policy — service_role ignora RLS (BYPASSRLS), então esta
-- policy só formaliza a negação para anon/authenticated.
drop policy if exists "push_dispatch_config_deny_client_access" on public.push_dispatch_config;
create policy "push_dispatch_config_deny_client_access"
  on public.push_dispatch_config for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- subscription_finalization_config
-- ============================================================================
-- Privilégios de tabela já revogados/concedidos em 20260811162000
-- (revoke all from public/anon/authenticated; grant select to service_role).
-- Faltava só a policy, mesmo raciocínio de push_dispatch_config acima.
drop policy if exists "subscription_finalization_config_deny_client_access" on public.subscription_finalization_config;
create policy "subscription_finalization_config_deny_client_access"
  on public.subscription_finalization_config for all
  to anon, authenticated
  using (false)
  with check (false);

-- ============================================================================
-- subscription_idempotency_keys
-- ============================================================================
revoke all on public.subscription_idempotency_keys from public, anon, authenticated;

drop policy if exists "subscription_idempotency_keys_deny_client_access" on public.subscription_idempotency_keys;
create policy "subscription_idempotency_keys_deny_client_access"
  on public.subscription_idempotency_keys for all
  to anon, authenticated
  using (false)
  with check (false);

notify pgrst, 'reload schema';
