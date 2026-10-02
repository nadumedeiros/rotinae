-- Corrige o autoatendimento do cliente (`app/client-booking.tsx`): o
-- calendário mostrava dias como disponíveis mesmo quando o prestador havia
-- configurado, para aquele cliente específico, um "Período para solicitar"
-- (`clients.request_window_start`/`request_window_end`) mais restrito, ou já
-- havia atingido `total_booking_limit`/`daily_booking_limit`. O cliente só
-- descobria a restrição ao tentar confirmar o agendamento, quando
-- `_create_appointment_row` (20260819100000_provider_plan_horizon_limit.sql,
-- bloco `if v_requested_by = 'client' then ...`) já rejeita corretamente com
-- `OUTSIDE_ALLOWED_PERIOD`/`DAILY_LIMIT_REACHED`/`TOTAL_LIMIT_REACHED` — essa
-- checagem no servidor está correta e permanece INTOCADA por esta migration.
--
-- Causa raiz: `get_client_booking_context` (última definição em
-- 20260813150000_client_booking_context_durable_role.sql) nunca selecionava
-- essas quatro colunas de `clients` — a informação simplesmente não chegava
-- ao frontend, que não tinha como desabilhar visualmente um dia fora do
-- período ou avisar sobre cota esgotada antes da tentativa de confirmação.
--
-- Correção: apenas ADITIVA. Estende o `jsonb_build_object` já existente com:
--   - `requestWindowStart`/`requestWindowEnd` (date as text 'YYYY-MM-DD',
--     `null` = sem restrição de período) — mesmas colunas
--     `v_client_window_start`/`v_client_window_end` de `_create_appointment_row`.
--   - `totalBookingLimit`/`dailyBookingLimit` (`null` = sem limite) — mesmas
--     colunas `v_client_total_limit`/`v_client_daily_limit`.
--   - `totalBookingCount`: contagem de agendamentos não cancelados do
--     cliente, MESMA regra de `v_total_count` em `_create_appointment_row`
--     (`a.client_id = c.id and a.state <> 'cancelled'`, sem filtro de data).
--     Não é enviada uma contagem "por dia" pré-calculada: o dia escolhido só
--     existe depois da interação do cliente, então o cálculo por dia
--     permanece client-side, combinando `dailyBookingLimit` com os
--     agendamentos que a tela já carrega/mostra (occupiedStartsAt já cobre o
--     mês corrente).
--
-- Nenhuma outra linha da função muda: mesmo `join`/`where` (incluindo a
-- correção de 20260813150000 contra `profile_roles`), mesma assinatura
-- (`p_month text`) e mesmo tipo de retorno (`jsonb`) — `create or replace
-- function` é suficiente, como nas três migrations anteriores que já
-- tocaram esta mesma função.
--
-- Uso EXCLUSIVO destes campos novos pelo frontend: feedback visual antecipado
-- (ex.: desabilitar um dia fora do período, avisar cota esgotada). A decisão
-- final sobre se um agendamento pode ou não ser criado continua, sempre, no
-- servidor (`_create_appointment_row`) — o frontend nunca deve decidir
-- sozinho com base apenas nestes campos.
create or replace function public.get_client_booking_context(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'INVALID_DATE_TIME: month must use YYYY-MM' using errcode = '22023';
  end if;

  v_start := (p_month || '-01T00:00:00Z')::timestamptz;
  v_end := v_start + interval '1 month';

  select coalesce(jsonb_agg(provider_row order by provider_row->>'providerName'), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
      'tenantId', t.id,
      'providerId', t.owner_user_id,
      'providerName', coalesce(nullif(trim(p.display_name), ''), 'Prestador'),
      'profession', t.profession,
      'attendanceDays', coalesce(t.attendance_days, array[0,1,2,3,4,5,6]::smallint[]),
      'clientId', c.id,
      'primaryServiceId', c.primary_service_id,
      'timezone', coalesce(t.timezone, 'America/Sao_Paulo'),
      'workdayStart', coalesce(t.workday_start::text, '08:00:00'),
      'workdayEnd', coalesce(t.workday_end::text, '18:00:00'),
      'minimumAdvanceHours', coalesce(t.minimum_advance_hours, 0),
      -- RN-AGD-030 (correção deste bug): mesma fonte de verdade consultada
      -- por `_create_appointment_row` para o CLIENTE que está chamando este
      -- RPC (`c` já é o registro do cliente resolvido por
      -- `c.client_user_id = v_user`, logo abaixo). `null` em qualquer um dos
      -- quatro campos preserva o significado de "sem restrição"/"sem limite"
      -- já usado no banco (constraint `clients_booking_window_pair`, checks
      -- de `total_booking_limit`/`daily_booking_limit` >= 1).
      'requestWindowStart', c.request_window_start,
      'requestWindowEnd', c.request_window_end,
      'totalBookingLimit', c.total_booking_limit,
      'dailyBookingLimit', c.daily_booking_limit,
      'totalBookingCount', (
        select count(*)
        from public.appointments a
        where a.client_id = c.id and a.state <> 'cancelled'
      ),
      'services', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'durationMinutes', s.duration_minutes,
          'referenceValueCents', s.reference_value_cents
        ) order by s.name)
        from public.services s where s.tenant_id = t.id and s.status = 'active'
      ), '[]'::jsonb),
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object('startsAt', b.starts_at, 'endsAt', b.ends_at))
        from public.availability_blocks b
        where b.tenant_id = t.id and b.starts_at < v_end and b.ends_at > v_start
      ), '[]'::jsonb),
      'occupiedStartsAt', coalesce((
        select jsonb_agg(a.starts_at order by a.starts_at)
        from public.appointments a
        where a.tenant_id = t.id and a.state = 'scheduled'
          and a.starts_at >= v_start and a.starts_at < v_end
      ), '[]'::jsonb)
    ) provider_row
    from public.provider_client_links l
    join public.tenants t on t.id = l.tenant_id
    join public.profiles p on p.user_id = t.owner_user_id
    join public.clients c on c.tenant_id = t.id and c.client_user_id = v_user and c.status = 'active'
    where l.client_user_id = v_user and l.status = 'active'
      and exists (
        select 1 from public.profile_roles pr
        where pr.user_id = t.owner_user_id and pr.role = 'provider'
      )
  ) linked;

  return v_result;
end;
$$;

revoke all on function public.get_client_booking_context(text) from public, anon;
grant execute on function public.get_client_booking_context(text) to authenticated;

-- ============================================================================
-- Verificação estrutural (mesmo padrão de outras migrations desta série,
-- ex.: 20260819100000) — checagens de definição de função, sem depender de
-- sessão/JWT.
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_client_booking_context';

  assert v_definition like '%requestWindowStart%',
    'get_client_booking_context deveria retornar requestWindowStart';
  assert v_definition like '%requestWindowEnd%',
    'get_client_booking_context deveria retornar requestWindowEnd';
  assert v_definition like '%totalBookingLimit%',
    'get_client_booking_context deveria retornar totalBookingLimit';
  assert v_definition like '%dailyBookingLimit%',
    'get_client_booking_context deveria retornar dailyBookingLimit';
  assert v_definition like '%totalBookingCount%',
    'get_client_booking_context deveria retornar totalBookingCount';

  raise notice 'client_booking_context_request_window_limits: verificações estruturais passaram.';
end $$;
