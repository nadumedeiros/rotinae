-- "Dias de atendimento semanais" do prestador (RN-AGD-025/027/028/029,
-- RF-AGE-014-019; BACKLOG.md, DEC-139/BLG-080;
-- docs/HANDOFF_UX_DIAS_ATENDIMENTO_DANTE.md, seção 7.1 — handoff técnico
-- para Chris).
--
-- ============================================================================
-- DECISÃO DE SCHEMA — `attendance_days` mora em `tenants`, tipo `smallint[]`
-- ============================================================================
--
-- 1. TABELA: mesma razão já registrada para `workday_start`/`workday_end`/
--    `minimum_advance_hours` (20260806101800) — dias de atendimento são
--    regra OPERACIONAL do tenant (agenda), não identidade do prestador; não
--    há tabela própria por YAGNI (mesmo racional já aplicado a toda a
--    família de `ProviderSettings`, DEC-072/BLG-049).
--
-- 2. TIPO: `smallint[]`, não 7 colunas booleanas nem bitmask inteiro.
--    Escolhido porque:
--    a) O domínio já usa exatamente esse formato — `ClientBookingPolicy.
--       allowedWeekdays: number[]` e `isDayAllowed`
--       (src/domain/agenda/client-booking-policy.ts, via
--       `new Date(...).getDay()`) já operam sobre um array de inteiros na
--       convenção JS (0=domingo, 1=segunda, ..., 6=sábado — a mesma usada
--       por `defaultProviderSchedule.allowedWeekdays: [1,2,3,4,5]` hoje fixo
--       em `app/client-booking.tsx`). Persistir no mesmo formato remove
--       qualquer tradução bitmask<->array ou booleanos<->array tanto no
--       adaptador quanto nas RPCs — o valor lido do banco é literalmente o
--       array que a política de domínio já consome, sem etapa intermediária.
--    b) 7 colunas booleanas exigiriam 7 parâmetros/chaves adicionais em
--       `update_provider_settings`/`get_client_booking_context`, só para
--       depois recompor um array no adaptador — mais superfície de mudança
--       para o mesmo resultado, sem ganho de legibilidade ou performance
--       nesta cardinalidade (1 linha por tenant).
--    c) Bitmask (integer) economiza bytes de forma irrelevante neste volume
--       e obrigaria toda leitura/escrita a aplicar operações de bit a bit em
--       SQL e/ou TypeScript — complexidade sem benefício mensurável (YAGNI).
--
-- 3. NOME: `attendance_days` (não `allowed_weekdays`) — o nome de coluna
--    reflete a CONFIGURAÇÃO do prestador (`ProviderSettings.attendanceDays`,
--    mesmo nome devolvido por `get_client_booking_context`, mesma
--    consistência de nomes já aplicada a `profession` entre os dois
--    contratos, DEC-137/20260813120000); `allowedWeekdays` continua sendo o
--    nome do campo de POLÍTICA já efetiva em
--    `src/domain/agenda/client-booking-policy.ts` — a ADA monta
--    `policy.allowedWeekdays` a partir de `attendanceDays` do contexto, mesmo
--    padrão já usado hoje para `workdayStart`/`workdayEnd` (nomes de
--    contexto) -> `startTime`/`endTime` (nomes de política).
--
-- 4. INVARIANTE "não vazio" (RN-AGD-025) — reforçada em profundidade por
--    CHECK constraint de banco (não confiar apenas na validação client-side
--    do adaptador/tela, seção 2.4 do handoff de UX), mesmo padrão de
--    `tenants_workday_order_check`/`tenants_profession_length_check`
--    (20260806101800/20260813120000). A constraint também valida que cada
--    elemento cai no intervalo válido 0-6 — defesa contra qualquer caminho
--    que não passe pela UI (chamada direta à RPC/REST, dado corrompido).
--
-- 5. DEFAULT — `array[0,1,2,3,4,5,6]::smallint[]` (todos os 7 dias),
--    aplicado via DEFAULT de coluna NOT NULL: tenants existentes recebem o
--    valor automaticamente no próprio ALTER TABLE (preenchimento de
--    metadado, Postgres >= 11, sem necessidade de UPDATE explícito em
--    massa) e tenants novos nascem com o mesmo padrão — RN-AGD-029.
--
-- 6. NÃO RETROATIVO (RN-AGD-028) — nenhuma trigger ou lógica desta migration
--    toca `appointments`/`appointment_series` (ou qualquer tabela de
--    agendamento); mudar este campo nunca cancela, remarca ou altera
--    agendamentos existentes.
--
-- 7. ESCOPO DESTA ENTREGA — RN-AGD-027 ("a restrição só vale para
--    criação/remarcação solicitada pelo CLIENTE") não é implementada nesta
--    migration: `_create_appointment_row`/`update_appointment`
--    (20260806102200) não são tocadas aqui. Esta migration cobre somente o
--    contrato de leitura/escrita de `ProviderSettings`
--    (`update_provider_settings`) e o contrato de leitura do cliente
--    (`get_client_booking_context`) — a validação de "o cliente não pode
--    solicitar um agendamento fora do dia de atendimento do prestador" fica
--    registrada como pendência de escopo (ver retorno ao coordenador), a ser
--    aplicada em `_create_appointment_row`/`update_appointment` seguindo o
--    mesmo precedente já usado por `v_requested_by = 'client'`
--    (RN-AGD-015-022).

-- ============================================================================
-- Coluna aditiva, NOT NULL com default, sem UPDATE de backfill explícito
-- ============================================================================

alter table public.tenants
  add column if not exists attendance_days smallint[]
    not null default array[0,1,2,3,4,5,6]::smallint[];

do $$ begin
  alter table public.tenants
    add constraint tenants_attendance_days_check
      check (
        attendance_days is not null
        and cardinality(attendance_days) > 0
        and attendance_days <@ array[0,1,2,3,4,5,6]::smallint[]
      );
exception when duplicate_object then null; end $$;

-- ============================================================================
-- RLS — nenhuma policy nova necessária
-- ============================================================================
--
-- `attendance_days` é só mais uma coluna da mesma linha de `tenants` já
-- coberta por `tenants_select_owner`/`tenants_update_owner` (dono,
-- 20260806100200) e por `tenants_select_active_client` (cliente com vínculo
-- ativo, corrigida em 20260812150000) — RLS do Postgres é por LINHA, não por
-- coluna, então as policies já existentes autorizam exatamente o mesmo
-- dono/cliente vinculado a ler/gravar o novo campo, sem exceção nem policy
-- adicional. Mesma nota já registrada para `workday_start`/`workday_end`/
-- `minimum_advance_hours`/`profession`.

-- ============================================================================
-- Auditoria — reaproveita a ação `tenants.schedule_updated` já existente
-- (20260806101800): dias de atendimento são a mesma categoria de regra
-- operacional de agenda que jornada/antecedência, não identidade pública
-- (categoria separada de `profession`, que tem sua própria ação desde
-- 20260813120000).
-- ============================================================================

drop trigger if exists tenants_audit_schedule_change on public.tenants;
create trigger tenants_audit_schedule_change
  after update of workday_start, workday_end, minimum_advance_hours, attendance_days
  on public.tenants
  for each row
  when (
    old.workday_start is distinct from new.workday_start
    or old.workday_end is distinct from new.workday_end
    or old.minimum_advance_hours is distinct from new.minimum_advance_hours
    or old.attendance_days is distinct from new.attendance_days
  )
  execute function public.audit_tenant_schedule_change();

-- ============================================================================
-- RPC `update_provider_settings` — novo parâmetro, com DEFAULT NULL
-- ============================================================================
--
-- Postgres não permite `create or replace function` alterar a lista de
-- parâmetros (mesma situação já resolvida em 20260806101600/20260813120000)
-- — a função de 9 parâmetros é removida explicitamente antes de recriar a de
-- 10.
--
-- Diferente de `new_profession` (aceita `null` como valor de negócio válido,
-- "sem profissão informada"), `attendance_days` NUNCA pode ser vazio como
-- valor de negócio (RN-AGD-025) — então `null` aqui significa "o chamador
-- não enviou este campo" (mesmo racional de `app/settings.tsx` ainda não ter
-- sido religado a este campo por ADA nesta entrega, exatamente como
-- documentado para `profession` em 20260813120000), nunca "esvaziar a
-- configuração". Por isso o parâmetro tem `default null` e o UPDATE usa
-- `coalesce(new_attendance_days, tenants.attendance_days)` — preserva o
-- valor já configurado quando o chamador omite o campo, e ainda assim
-- rejeita (via CHECK) uma tentativa EXPLÍCITA de salvar
-- `array[]::smallint[]` (grupo vazio é uma escolha deliberada inválida, não
-- "campo omitido" — `coalesce` só substitui em cima de `null`, nunca de um
-- array vazio não nulo).
drop function if exists public.update_provider_settings(
  text, text, text, text, time, time, integer, boolean, boolean
);

create or replace function public.update_provider_settings(
  new_display_name text,
  new_phone text,
  new_profession text,
  new_timezone text,
  new_workday_start time,
  new_workday_end time,
  new_minimum_advance_hours integer,
  new_email_notifications boolean,
  new_push_notifications boolean,
  new_attendance_days smallint[] default null
)
returns table (
  user_id uuid,
  display_name text,
  phone text,
  email_notifications boolean,
  push_notifications boolean,
  profile_updated_at timestamptz,
  timezone text,
  workday_start time,
  workday_end time,
  minimum_advance_hours integer,
  profession text,
  attendance_days smallint[],
  tenant_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_profile_user_id uuid;
  v_profile_display_name text;
  v_profile_phone text;
  v_profile_email_notifications boolean;
  v_profile_push_notifications boolean;
  v_profile_updated_at timestamptz;
  v_tenant_timezone text;
  v_tenant_workday_start time;
  v_tenant_workday_end time;
  v_tenant_minimum_advance_hours integer;
  v_tenant_profession text;
  v_tenant_attendance_days smallint[];
  v_tenant_updated_at timestamptz;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  update public.profiles
    set display_name = new_display_name,
        phone = new_phone,
        email_notifications = new_email_notifications,
        push_notifications = new_push_notifications
  where public.profiles.user_id = v_caller
  returning public.profiles.user_id, public.profiles.display_name, public.profiles.phone,
            public.profiles.email_notifications, public.profiles.push_notifications,
            public.profiles.updated_at
  into v_profile_user_id, v_profile_display_name, v_profile_phone,
       v_profile_email_notifications, v_profile_push_notifications, v_profile_updated_at;

  if not found then
    raise exception 'PROFILE_NOT_FOUND: profile does not exist for the caller' using errcode = '22023';
  end if;

  update public.tenants
    set timezone = new_timezone,
        workday_start = new_workday_start,
        workday_end = new_workday_end,
        minimum_advance_hours = new_minimum_advance_hours,
        profession = new_profession,
        attendance_days = coalesce(new_attendance_days, public.tenants.attendance_days)
  where public.tenants.owner_user_id = v_caller
  returning public.tenants.timezone, public.tenants.workday_start, public.tenants.workday_end,
            public.tenants.minimum_advance_hours, public.tenants.profession,
            public.tenants.attendance_days, public.tenants.updated_at
  into v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
       v_tenant_minimum_advance_hours, v_tenant_profession, v_tenant_attendance_days,
       v_tenant_updated_at;

  if not found then
    raise exception 'FORBIDDEN: caller does not own a tenant' using errcode = '42501';
  end if;

  return query
  select v_profile_user_id, v_profile_display_name, v_profile_phone,
         v_profile_email_notifications, v_profile_push_notifications, v_profile_updated_at,
         v_tenant_timezone, v_tenant_workday_start, v_tenant_workday_end,
         v_tenant_minimum_advance_hours, v_tenant_profession, v_tenant_attendance_days,
         v_tenant_updated_at;
end;
$$;

revoke all on function public.update_provider_settings(
  text, text, text, text, time, time, integer, boolean, boolean, smallint[]
) from public, anon, authenticated;
grant execute on function public.update_provider_settings(
  text, text, text, text, time, time, integer, boolean, boolean, smallint[]
) to authenticated;

-- Nota sobre auditoria desta RPC: o `update` de `tenants` acima dispara
-- `tenants_audit_schedule_change` normalmente quando `attendance_days`
-- muda (trigger reage à tabela, não a quem chamou o `update`) — mesma nota
-- já registrada em 20260806101800/20260813120000 para as demais RPCs de
-- escrita atômica multi-tabela.

-- ============================================================================
-- RPC `get_client_booking_context` — propaga `attendanceDays` ao cliente
-- ============================================================================
--
-- Mesma função de 20260810230000 (última reescrita em 20260813120000, que
-- adicionou `profession`), com um campo novo (`attendanceDays`) adicionado
-- ao `jsonb_build_object`. Nenhuma outra linha muda. Não há alteração de
-- assinatura (`p_month text`) nem de tipo de retorno (`jsonb`), então
-- `create or replace function` é suficiente aqui — diferente da RPC acima.
-- `coalesce` com o array de 7 dias é defensivo (mesma postura já aplicada a
-- `timezone`/`workday_start`/`workday_end`/`minimum_advance_hours` nesta
-- mesma função): a coluna é `not null` com default, então nunca deveria
-- chegar `null` aqui, mas o `coalesce` custa nada e documenta a intenção.
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
    join public.profiles p on p.user_id = t.owner_user_id and p.role = 'provider'
    join public.clients c on c.tenant_id = t.id and c.client_user_id = v_user and c.status = 'active'
    where l.client_user_id = v_user and l.status = 'active'
  ) linked;

  return v_result;
end;
$$;

revoke all on function public.get_client_booking_context(text) from public, anon;
grant execute on function public.get_client_booking_context(text) to authenticated;
