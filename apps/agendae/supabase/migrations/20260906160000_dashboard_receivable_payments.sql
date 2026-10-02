-- ============================================================================
-- Home: painel novo "Pagamentos a receber" (pedido de produto, 06/09/2026)
-- ============================================================================
--
-- CONTEXTO: `app/dashboard.tsx` (Home do prestador) vai ganhar um painel
-- novo ao lado de "Agenda de hoje", listando as cobranças ainda em aberto
-- (pendentes/atrasadas) do prestador, mais urgente primeiro. A implementação
-- de UI é responsabilidade de outra frente — esta migration só prepara o
-- contrato de dados: `get_provider_dashboard_snapshot`
-- (consumida via `DashboardPort.getSnapshot()`) passa a trazer também essa
-- lista, já pronta para o card novo.
--
-- CUIDADO EXTRA (pedido explícito): esta é a RPC da tela de maior tráfego do
-- app. Esta migration reafirma (`create or replace`) o corpo INTEIRO já
-- vigente em produção (redefinido por completo em
-- 20260823130000_manual_payments_receipt_history.sql) e faz UMA única
-- adição — nenhum KPI, cálculo ou campo pré-existente é alterado ou
-- removido.
--
-- ADIÇÃO:
-- - `receivable_payments`: array com até 5 cobranças (`kind = 'charge'`,
--   `status in ('pending','overdue')`) do tenant do prestador chamador,
--   ordenadas por `due_date` ascendente — como cobranças atrasadas têm
--   `due_date` no passado, esta única ordenação já traz a mais atrasada
--   primeiro, depois as pendentes mais próximas de vencer, sem precisar de
--   um `case` extra para separar os dois grupos. Cada item: `id`,
--   `client_name` (mesmo padrão de "Sem cliente" já usado em
--   `todayAppointments`/`get_manual_payment_history` quando `client_id` é
--   nulo), `origin` (mesma coluna de `manual_payments`), `balance_cents`
--   (saldo AINDA em aberto daquela cobrança), `due_date`, `status`.
-- - `receivable_total_cents` / `receivable_count` (nível raiz do retorno,
--   fora do array): soma/contagem de TODAS as cobranças pendentes/atrasadas
--   do tenant, não só as até 5 exibidas no card.
--
-- `balance_cents` usa EXATAMENTE o mesmo cálculo já usado em
-- `list_manual_payments`/`get_manual_payment_history`
-- (20260906150000_payment_balance_cents.sql): total da cobrança
-- (`value_cents`) menos a soma dos `receipt` filhos com `status = 'received'`,
-- nunca negativo — para os números baterem entre a Home e a tela de
-- Pagamentos (`app/payments.tsx`/`app/payments/history.tsx`).
--
-- Nomenclatura das chaves do JSON: propositalmente em snake_case
-- (`client_name`, `origin`, `balance_cents`, `due_date`, `status`,
-- `receivable_payments`, `receivable_total_cents`, `receivable_count`),
-- mesmo padrão de `list_manual_payments`/`get_manual_payment_history` — a
-- camada de aplicação (`SupabaseDashboardAdapter`) mapeia explicitamente
-- para os campos camelCase de `DashboardSnapshot`/`DashboardReceivablePayment`
-- (`src/domain/dashboard/types.ts`), com fallback (`[]`/`0`) caso o backend
-- ainda não traga estes campos (compatibilidade com deploy em duas etapas).
create or replace function public.get_provider_dashboard_snapshot(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_user_display_name text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_month_start date;
  v_month_end date;
  v_summary jsonb;
  v_appointments jsonb;
  v_receivable_payments jsonb;
  v_receivable_total_cents integer;
  v_receivable_count integer;
begin
  -- 1. Busca o tenant do prestador
  select * into v_tenant
  from public.tenants
  where owner_user_id = auth.uid() and status = 'active'
  limit 1;

  -- 2. Se não existir, auto-provisiona o perfil e o tenant
  if not found then
    select coalesce(p.display_name, u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1), 'Prestador')
    into v_user_display_name
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where u.id = auth.uid();

    insert into public.profiles (user_id, role, display_name, phone)
    values (auth.uid(), 'provider', coalesce(v_user_display_name, 'Prestador'), null)
    on conflict (user_id) do update
    set role = 'provider'
    where public.profiles.role is distinct from 'provider';

    insert into public.profile_roles (user_id, role)
    values (auth.uid(), 'provider')
    on conflict (user_id, role) do nothing;

    insert into public.tenants (owner_user_id, display_name, timezone, status)
    values (auth.uid(), coalesce(v_user_display_name, 'Meu Espaço'), 'America/Sao_Paulo', 'active')
    returning * into v_tenant;

    insert into public.provider_settings (
      provider_user_id,
      timezone,
      slot_interval_minutes,
      min_advance_hours,
      business_hours_start,
      business_hours_end,
      booking_window_days
    ) values (
      auth.uid(),
      'America/Sao_Paulo',
      30,
      0,
      '08:00',
      '18:00',
      60
    ) on conflict (provider_user_id) do nothing;
  end if;

  -- 3. Datas e fusos
  v_date := coalesce(p_date, (now() at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))::date);
  v_start := v_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_end := (v_date + 1)::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo');
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  -- 4. KPIs do resumo consolidados
  select jsonb_build_object(
    -- Clientes Ativos: clientes cadastrados com status active
    'activeClients', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id and c.status = 'active'
    ), 0),

    -- Novos Clientes no Mês
    'newClientsThisMonth', coalesce((
      select count(*)
      from public.clients c
      where c.tenant_id = v_tenant.id
        and c.status = 'active'
        and c.created_at >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
        and c.created_at < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
    ), 0),

    -- Agendamentos de Hoje (total não cancelado no dia)
    'appointmentsToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
    ), 0),

    -- Atendimentos Concluídos Hoje
    'completedToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state <> 'cancelled'
        and (state = 'completed' or ends_at <= now())
    ), 0),

    -- Aguardando Confirmação Hoje
    'pendingConfirmationToday', coalesce((
      select count(*)
      from public.appointments
      where tenant_id = v_tenant.id
        and starts_at >= v_start
        and starts_at < v_end
        and state = 'scheduled'
        and confirmation_status = 'pending'
    ), 0),

    -- Faturamento / Saldo Recebido no Mês — mesma regra de
    -- `list_manual_payments` (recibos quitados + cobranças quitadas sem
    -- nenhum recibo filho, evitando contar o mesmo valor duas vezes).
    -- Filtro por mês usa a mesma cascata `received_at -> due_date ->
    -- created_at` já usada pelo cálculo espelho em
    -- `enrichRealDashboardMetrics` (adapter), preservada aqui em vez de
    -- trocar para `due_date` puro (usado por `list_manual_payments`) porque
    -- o conceito de "faturamento do mês" desta tela sempre foi "quando o
    -- dinheiro entrou", não "quando a cobrança venceu" — nuance
    -- pré-existente e fora do escopo desta correção.
    'serviceBalanceCents',
      coalesce((
        select sum(r.value_cents)
        from public.manual_payments r
        where r.tenant_id = v_tenant.id
          and r.kind = 'receipt'
          and r.status = 'received'
          and coalesce(r.received_at, r.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), r.created_at)
            >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
          and coalesce(r.received_at, r.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), r.created_at)
            < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
      ), 0)
      + coalesce((
        select sum(c.value_cents)
        from public.manual_payments c
        where c.tenant_id = v_tenant.id
          and c.kind = 'charge'
          and c.status = 'received'
          and not exists (
            select 1 from public.manual_payments cr
            where cr.parent_payment_id = c.id and cr.kind = 'receipt'
          )
          and coalesce(c.received_at, c.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), c.created_at)
            >= (v_month_start::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
          and coalesce(c.received_at, c.due_date::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'), c.created_at)
            < (v_month_end::timestamp at time zone coalesce(v_tenant.timezone, 'America/Sao_Paulo'))
      ), 0),

    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  -- 5. Agendamentos de hoje (todos os compromissos do dia ordenados por horário)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', coalesce(c.name, 'Sem cliente'),
    'serviceName', coalesce(a.service_name_snapshot, 'Atendimento'),
    'serviceValueCents', coalesce(a.value_cents_snapshot, 0),
    'status', case
      when a.state = 'completed' or (a.ends_at <= now() and a.state <> 'cancelled') then 'completed'
      when a.state = 'cancelled' then 'cancelled'
      when a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.confirmation_status = 'no_show' then 'no_show'
      else 'confirmed'
    end
  ) order by a.starts_at asc), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  left join public.clients c on c.id = a.client_id
  where a.tenant_id = v_tenant.id
    and a.starts_at >= v_start
    and a.starts_at < v_end
    and a.state <> 'cancelled';

  -- 6. Pagamentos a receber (NOVO) — até 5 cobranças em aberto do tenant,
  -- mais urgente primeiro (due_date asc: atrasadas, com vencimento no
  -- passado, naturalmente vêm antes das pendentes futuras). Mesmo cálculo de
  -- saldo de `list_manual_payments`/`get_manual_payment_history`
  -- (20260906150000_payment_balance_cents.sql).
  select coalesce(jsonb_agg(top_receivables.row_data order by top_receivables.due_date asc), '[]'::jsonb)
    into v_receivable_payments
  from (
    select
      jsonb_build_object(
        'id', c.id,
        'client_name', coalesce(cl.name, 'Sem cliente'),
        'origin', c.origin,
        'balance_cents', greatest(
          c.value_cents - coalesce((
            select sum(r.value_cents)
            from public.manual_payments r
            where r.parent_payment_id = c.id and r.kind = 'receipt' and r.status = 'received'
          ), 0),
          0
        ),
        'due_date', c.due_date,
        'status', c.status
      ) as row_data,
      c.due_date
    from public.manual_payments c
    left join public.clients cl on cl.id = c.client_id
    where c.tenant_id = v_tenant.id
      and c.kind = 'charge'
      and c.status in ('pending', 'overdue')
    order by c.due_date asc
    limit 5
  ) top_receivables;

  -- Total/contagem agregados sobre TODAS as cobranças em aberto do tenant
  -- (não só as até 5 exibidas acima).
  select
    coalesce(sum(greatest(
      c.value_cents - coalesce((
        select sum(r.value_cents)
        from public.manual_payments r
        where r.parent_payment_id = c.id and r.kind = 'receipt' and r.status = 'received'
      ), 0),
      0
    )), 0),
    count(*)
  into v_receivable_total_cents, v_receivable_count
  from public.manual_payments c
  where c.tenant_id = v_tenant.id
    and c.kind = 'charge'
    and c.status in ('pending', 'overdue');

  return jsonb_build_object(
    'providerDisplayName', coalesce(v_tenant.display_name, 'Prestador'),
    'timeZone', coalesce(v_tenant.timezone, 'America/Sao_Paulo'),
    'summary', v_summary,
    'todayAppointments', v_appointments,
    'notifications', '[]'::jsonb,
    'receivable_payments', v_receivable_payments,
    'receivable_total_cents', v_receivable_total_cents,
    'receivable_count', v_receivable_count
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;


-- ============================================================================
-- Verificação estrutural (mesmo padrão de 20260823130000/20260906150000)
-- ============================================================================
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_provider_dashboard_snapshot';

  assert v_definition like '%''receivable_payments''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_payments (cobrancas em aberto, ate 5, mais urgente primeiro)';
  assert v_definition like '%''receivable_total_cents''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_total_cents (soma agregada de todas as cobrancas em aberto)';
  assert v_definition like '%''receivable_count''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_count (contagem agregada de todas as cobrancas em aberto)';

  -- Garantias herdadas de 20260823130000: nada relacionado ao bug antigo
  -- (paid_at/status 'paid', inexistentes) volta a aparecer nesta redefinição.
  assert v_definition not like '%paid_at%',
    'get_provider_dashboard_snapshot não deveria voltar a referenciar a coluna inexistente paid_at';
  assert v_definition not like '%''paid''%',
    'get_provider_dashboard_snapshot não deveria voltar a referenciar o status inexistente paid';

  assert has_function_privilege('authenticated', 'public.get_provider_dashboard_snapshot(date)', 'execute'),
    'authenticated deveria poder executar get_provider_dashboard_snapshot';
  assert not has_function_privilege('anon', 'public.get_provider_dashboard_snapshot(date)', 'execute'),
    'anon nunca deveria poder executar get_provider_dashboard_snapshot';

  raise notice 'dashboard_receivable_payments: verificações estruturais passaram.';
end $$;

notify pgrst, 'reload schema';
