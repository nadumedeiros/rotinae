-- ============================================================================
-- get_provider_dashboard_snapshot — excluir da lista `todayAppointments`
-- agendamentos de hoje cujo horário já passou (BLG-093, DEC-151).
-- ============================================================================
--
-- RELATO DO USUÁRIO: o painel "Agenda de hoje" da Home do prestador
-- (`app/dashboard.tsx`) continuava mostrando agendamentos de HOJE com
-- horário já decorrido; o usuário quer ver só os futuros.
--
-- CAUSA RAIZ: a lista `todayAppointments` (distinta do `summary`/KPIs, que
-- devem continuar cobrindo o dia civil inteiro) filtrava só pela fronteira
-- do dia no fuso do tenant (`a.starts_at >= v_start and a.starts_at < v_end`),
-- sem nenhuma condição de "ainda não começou" — qualquer agendamento
-- não-cancelado de hoje aparecia, mesmo com o horário já passado. A mesma
-- lacuna já existia em `20260811143000_dashboard_snapshot.sql`; não é
-- regressão desta rodada.
--
-- CORREÇÃO: o limite inferior da lista passa de `v_start` para
-- `greatest(v_start, now())`. Para `p_date` igual à data corrente do
-- tenant (o caso do painel da Home), `now() > v_start` sempre, então o
-- filtro efetivo passa a ser "a partir de agora". Para uma eventual chamada
-- futura com `p_date` diferente de hoje (ex.: consulta de um dia passado ou
-- futuro), `greatest` preserva o comportamento atual sem efeito adicional:
-- num dia passado `v_end <= now()`, então a lista já sai vazia por conta do
-- limite superior, não do inferior; num dia futuro `v_start > now()`, então
-- `greatest(v_start, now()) = v_start`, idêntico ao filtro anterior. Nenhuma
-- mudança no `summary` (KPIs `appointmentsToday`/`completedToday`/
-- `pendingConfirmationToday`), que continuam contando o dia civil inteiro.
--
-- TRADE-OFF REGISTRADO (não resolvido nesta migration, ver DEC-151/BLG-093):
-- qualquer agendamento de hoje ainda `scheduled` cujo horário já passou
-- (ex.: prestador nunca confirmou/concluiu um atendimento das 9h e já são
-- 15h) some silenciosamente da lista assim que o horário passa, sem nunca
-- ter sido tratado (concluído, marcado "não compareceu" ou cancelado). É
-- exatamente o comportamento pedido pelo usuário, mas fica sem nenhum sinal
-- de atraso/pendência no painel — decisão consciente de não implementar
-- nenhuma solução (ex.: badge de atrasado) nesta rodada, YAGNI.
-- ============================================================================

create or replace function public.get_provider_dashboard_snapshot(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_month_start date;
  v_month_end date;
  v_summary jsonb;
  v_appointments jsonb;
begin
  select * into v_tenant
  from public.tenants
  where owner_user_id = auth.uid() and status = 'active'
  limit 1;

  if not found then
    raise exception 'FORBIDDEN: active provider tenant not found' using errcode = '42501';
  end if;

  v_date := coalesce(p_date, (now() at time zone v_tenant.timezone)::date);
  v_start := v_date::timestamp at time zone v_tenant.timezone;
  v_end := (v_date + 1)::timestamp at time zone v_tenant.timezone;
  v_month_start := date_trunc('month', v_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  -- `summary`/KPIs continuam cobrindo o DIA CIVIL INTEIRO (v_start/v_end),
  -- sem nenhuma condição de "ainda não começou" — inalterado nesta migration.
  select jsonb_build_object(
    'activeClients', (select count(*) from public.clients where tenant_id = v_tenant.id and status = 'active'),
    'newClientsThisMonth', (select count(*) from public.clients where tenant_id = v_tenant.id and created_at >= (v_month_start::timestamp at time zone v_tenant.timezone) and created_at < (v_month_end::timestamp at time zone v_tenant.timezone)),
    'appointmentsToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state <> 'cancelled'),
    'completedToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'completed'),
    'pendingConfirmationToday', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state = 'scheduled' and confirmation_status = 'pending'),
    'serviceBalanceCents', coalesce((select sum(value_cents) from public.manual_payments where tenant_id = v_tenant.id and kind = 'charge' and status in ('pending', 'overdue') and due_date >= v_month_start and due_date < v_month_end), 0),
    'balanceReferenceMonth', to_char(v_month_start, 'YYYY-MM')
  ) into v_summary;

  -- `todayAppointments`: lista exibida no painel. Limite inferior ajustado
  -- de `v_start` para `greatest(v_start, now())` — ver comentário de topo.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'startsAt', a.starts_at,
    'clientId', a.client_id,
    'clientName', coalesce(c.name, 'Sem cliente'),
    'serviceName', a.service_name_snapshot,
    'serviceValueCents', a.value_cents_snapshot,
    'status', case
      when a.state = 'scheduled' and a.confirmation_status = 'pending' then 'pending_confirmation'
      when a.state = 'scheduled' then 'confirmed'
      else a.state::text
    end
  ) order by a.starts_at), '[]'::jsonb)
  into v_appointments
  from public.appointments a
  left join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
  where a.tenant_id = v_tenant.id
    and a.starts_at >= greatest(v_start, now())
    and a.starts_at < v_end
    and a.state <> 'cancelled';

  return jsonb_build_object(
    'generatedAt', now(),
    'timeZone', v_tenant.timezone,
    'providerDisplayName', v_tenant.display_name,
    'summary', v_summary,
    'todayAppointments', v_appointments,
    'notifications', '[]'::jsonb
  );
end;
$$;

revoke all on function public.get_provider_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_provider_dashboard_snapshot(date) to authenticated;

-- ============================================================================
-- Verificação estrutural apenas (mesmo padrão de
-- `20260812140000_appointments_optional_client.sql`) — migration NÃO
-- executada contra um Postgres real neste ambiente (Docker inacessível ao
-- sandbox, mesma limitação já registrada em BLG-050/DEC-073). O adapter
-- (`SupabaseDashboardAdapter`) é um passthrough de RPC sem lógica de data
-- própria, então nenhum teste de TypeScript precisa mudar para este ajuste.
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_provider_dashboard_snapshot';

  assert v_definition like '%starts_at >= greatest(v_start, now())%',
    'get_provider_dashboard_snapshot deveria filtrar todayAppointments por greatest(v_start, now())';

  assert v_definition like '%''appointmentsToday'', (select count(*) from public.appointments where tenant_id = v_tenant.id and starts_at >= v_start and starts_at < v_end and state <> ''cancelled'')%',
    'summary.appointmentsToday deveria continuar cobrindo o dia civil inteiro (v_start), sem o ajuste de greatest(now())';

  raise notice 'dashboard_today_appointments_exclude_past: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;
