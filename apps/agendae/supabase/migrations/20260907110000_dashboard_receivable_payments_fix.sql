-- ============================================================================
-- Home: corrige a causa raiz de "Pagamentos a receber" aparecer zerado
-- ("0 cobrança(s) em aberto · R$ 0,00" / "Nenhum pagamento em aberto") mesmo
-- quando existem cobranças `pending`/`overdue` reais no tenant.
-- ============================================================================
--
-- CAUSA RAIZ CONFIRMADA (reproduzida com consulta manual read-only no
-- Postgres remoto, não é suposição):
--
-- O bloco 5 desta função ("Agendamentos de hoje") montava o campo `status`
-- de cada compromisso com um `when` que comparava a coluna
-- `a.confirmation_status` (enum) diretamente com o texto do estado
-- "sem comparecimento" (`no_show`), no lugar de comparar a coluna correta
-- (`a.state`).
--
-- Só que `'no_show'` NUNCA foi um valor válido do enum
-- `appointment_confirmation_status` (que só tem `pending`/`confirmed`) — é
-- um valor do enum `appointment_state` (`scheduled`/`completed`/
-- `cancelled`/`no_show`). Esse mesmo bug (comparar `confirmation_status` com
-- `'no_show'`) já tinha sido identificado e corrigido no lado
-- TypeScript (`src/infra/dashboard/supabase-dashboard-adapter.ts`, função
-- `enrichRealDashboardMetrics`, ver comentário ali), mas a função SQL nunca
-- recebeu a mesma correção e foi carregada inalterada por TODAS as
-- redefinições seguintes (`20260814150000`, `20260816223000`,
-- `20260817000500`, `20260906160000`, `20260906170000`, `20260907100000`).
--
-- Comparar uma coluna enum com um literal que não pertence ao enum não é um
-- "sempre falso" silencioso (como seria em TypeScript) — em Postgres, o
-- literal é convertido para o tipo do enum em tempo de PARSE da query, então
-- a conversão falha e lança `invalid input value for enum
-- appointment_confirmation_status: "no_show"` — SEMPRE, incondicionalmente,
-- mesmo que nenhuma linha da tabela tenha esse valor (confirmado rodando a
-- mesma query isolada com `and false` no WHERE: o erro ocorre do mesmo jeito,
-- provando que não depende de dado nenhum). Ou seja: `get_provider_dashboard_
-- snapshot` lança exceção em TODA chamada, para QUALQUER tenant, desde
-- 14/08/2026.
--
-- Isso ficou invisível porque `app/dashboard.tsx` (`loadDashboard`) engole o
-- erro num `catch` vazio, e `SupabaseDashboardAdapter.getSnapshot`
-- (`src/infra/dashboard/supabase-dashboard-adapter.ts`) trata qualquer erro
-- da RPC que não seja 42501/sessão como sinal para usar
-- `buildDirectDashboardSnapshot` — um caminho alternativo que recalcula
-- clientes/agenda/faturamento direto das tabelas (por isso esses números
-- sempre bateram certo) mas hardcoda `receivablePayments: [],
-- receivableTotalCents: 0, receivableCount: 0` (comentário explícito ali:
-- "Este caminho (fallback direto) não passa pela RPC — não há de onde
-- derivar 'pagamentos a receber' aqui"). Por isso SÓ o painel de pagamentos a
-- receber aparecia zerado, enquanto o resto da Home parecia normal — não
-- porque a lógica de `receivable_payments`/`receivable_total_cents`/
-- `receivable_count` estivesse errada (ela já foi validada, batendo com a
-- consulta manual: 5 cobranças `pending`/`overdue`, R$ 3.255,53), mas porque
-- a função inteira nunca chegava a executar esse trecho.
--
-- Correção: troca a coluna comparada de `a.confirmation_status` (que não tem
-- `'no_show'`) para `a.state` (que tem). Nenhuma outra linha desta função é
-- alterada — reafirma (`create or replace`) o corpo inteiro já vigente em
-- produção (`20260907100000_dashboard_receivable_payments_proximity_order.sql`).
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
  -- CORREÇÃO desta migration: `'no_show'` é valor de `a.state`, não de
  -- `a.confirmation_status` (o enum `appointment_confirmation_status` só tem
  -- `pending`/`confirmed`) — comparar a coluna `a.confirmation_status` com
  -- esse literal de estado (antes desta correção) lançava
  -- `invalid input value for enum appointment_confirmation_status` em toda
  -- chamada desta função, para qualquer tenant.
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
      when a.state = 'no_show' then 'no_show'
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

  -- 6. Pagamentos a receber — até 2 cobranças em aberto do tenant, ordenadas
  -- por PROXIMIDADE à data de hoje (herdado de
  -- 20260907100000_dashboard_receivable_payments_proximity_order.sql, sem
  -- alteração nesta migration — a lógica deste bloco já estava correta).
  select coalesce(jsonb_agg(top_receivables.row_data order by top_receivables.proximity_days asc, top_receivables.due_date asc), '[]'::jsonb)
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
      c.due_date,
      abs(c.due_date - current_date) as proximity_days
    from public.manual_payments c
    left join public.clients cl on cl.id = c.client_id
    where c.tenant_id = v_tenant.id
      and c.kind = 'charge'
      and c.status in ('pending', 'overdue')
    order by abs(c.due_date - current_date) asc, c.due_date asc
    limit 2
  ) top_receivables;

  -- Total/contagem agregados sobre TODAS as cobranças em aberto do tenant
  -- (não só as até 2 exibidas acima) — inalterado.
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
-- Verificação estrutural (mesmo padrão de 20260823130000/20260906150000/
-- 20260906160000/20260906170000/20260907100000)
-- ============================================================================
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid) into strict v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_provider_dashboard_snapshot';

  assert v_definition like '%''receivable_payments''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_payments (cobrancas em aberto, ate 2, mais proxima de hoje primeiro)';
  assert v_definition like '%''receivable_total_cents''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_total_cents (soma agregada de todas as cobrancas em aberto)';
  assert v_definition like '%''receivable_count''%',
    'get_provider_dashboard_snapshot deveria retornar receivable_count (contagem agregada de todas as cobrancas em aberto)';

  -- Confirma que a subquery de receivable_payments continua limitando em 2.
  assert v_definition like '%limit 2%',
    'get_provider_dashboard_snapshot deveria limitar receivable_payments a 2 cobrancas (limit 2)';

  -- Confirma que a ordenação por proximidade à data de hoje continua presente.
  assert v_definition like '%abs(c.due_date - current_date)%',
    'get_provider_dashboard_snapshot deveria ordenar receivable_payments por proximidade a hoje (abs(c.due_date - current_date))';

  -- CORREÇÃO DESTA MIGRATION: `no_show` só pode ser comparado contra
  -- `a.state` (valor válido no enum appointment_state), nunca mais contra
  -- `a.confirmation_status` (que não tem esse valor e quebrava a função
  -- inteira em toda chamada).
  assert v_definition like '%a.state = ''no_show''%',
    'get_provider_dashboard_snapshot deveria comparar a.state (nao a.confirmation_status) com o literal ''no_show''';
  assert v_definition not like '%a.confirmation_status = ''no_show''%',
    'get_provider_dashboard_snapshot nao deveria mais comparar a.confirmation_status com o literal invalido ''no_show''';

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

  raise notice 'dashboard_receivable_payments_fix: verificações estruturais passaram.';
end $$;

notify pgrst, 'reload schema';
