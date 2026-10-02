-- Migration: compromisso sem cliente ganha título livre obrigatório e
-- serviço do catálogo opcional (DECISÃO DE PRODUTO 2026-08-18).
--
-- ============================================================================
-- NOTA DE ESCOPO — por que esta migration cobre DUAS regras, não só a de
-- serviço opcional
-- ============================================================================
--
-- O pedido original desta entrega partia da premissa de que uma migration
-- anterior (`20260818100000_appointment_title_field.sql`) já tinha tornado
-- `appointments.title` obrigatório quando `client_id` é nulo, deixando
-- `service_id` como o único item pendente. Essa premissa foi verificada e é
-- FALSA neste branch: não existe arquivo `20260818100000_appointment_title_
-- field.sql` em `apps/agendae/supabase/migrations` (nem no branch `main`,
-- nem em nenhum dos outros worktrees de agente ativos no repositório no
-- momento desta entrega), não existe coluna `title` em `public.appointments`
-- e não existe nenhuma função `assertAppointmentHasSubject` em
-- `domain/agenda/types.ts`. A última redefinição real de
-- `_create_appointment_row` (`20260817000100_fix_provider_confirmation_
-- source.sql`) ainda exige `service_id` sempre, com ou sem cliente, e não
-- conhece `title`.
--
-- Como a regra de negócio final só é segura quando as DUAS metades valem
-- SIMULTANEAMENTE ("sem cliente, título é obrigatório" IMPEDE que um
-- compromisso nasça sem nenhum campo identificador, agora que o serviço
-- também passa a ser opcional sem cliente), esta migration entrega as duas
-- metades juntas, numa única transação de schema, em vez de assumir uma
-- pré-condição que não existe.
--
-- Depende de: 20260806102100_appointments.sql (tabela, view, trigger de
-- imutabilidade), 20260812140000_appointments_optional_client.sql
-- (client_id opcional), 20260817000100_fix_provider_confirmation_source.sql
-- (última redefinição de `_create_appointment_row`, ponto de partida do
-- corpo abaixo), 20260816235000_provider_unrestricted_advance_notice.sql
-- (última redefinição de `update_appointment`, que NÃO precisa de nenhuma
-- alteração nesta migration — ver nota específica mais abaixo).

-- ============================================================================
-- 1) Schema — coluna `title`, `service_id`/snapshots passam a aceitar NULL
-- ============================================================================

alter table public.appointments add column if not exists title text;

alter table public.appointments
  add constraint appointments_title_not_blank_check
  check (title is null or char_length(btrim(title)) between 1 and 120);

comment on column public.appointments.title is
  'Título livre do compromisso (ex.: "Reunião", "Bloqueio pessoal"), digitado '
  'pelo prestador. Obrigatório quando `client_id` é nulo — ver '
  'appointments_client_or_title_check. Nunca reescrito por `update_appointment` '
  '(mesma imutabilidade de client_id/service_id: trocar o assunto de um '
  'compromisso já criado equivale a um compromisso novo, não a uma remarcação).';

-- BACKFILL — obrigatório ANTES de adicionar `appointments_client_or_title_
-- check` abaixo: toda linha PRÉ-EXISTENTE sem cliente (DEC-127) nasceu antes
-- de `title` existir, então `title` chega NULL para elas por causa do
-- `add column` acima. Sem este passo, a constraint seguinte rejeitaria a
-- migration inteira na primeira aplicação contra um banco com dados reais.
-- Fallback: reaproveita `service_name_snapshot` (a regra vigente até aqui
-- sempre exigia serviço, com ou sem cliente) e, no caso extremo de não haver
-- nem isso, um rótulo genérico — nunca deixa a linha sem identificador.
update public.appointments
set title = coalesce(service_name_snapshot, 'Compromisso')
where client_id is null and title is null;

-- `service_id`/os snapshots do catálogo passam a ser opcionais quando não há
-- cliente (DECISÃO DE PRODUTO 2026-08-18): sem cliente, o usuário pode optar
-- por preencher só o título livre, sem escolher um serviço do catálogo.
-- As duas check constraints pré-existentes
-- (`appointments_service_name_snapshot_not_blank_check`,
-- `appointments_value_snapshot_non_negative_check`) já toleram NULL sem
-- qualquer alteração: uma CHECK do Postgres é satisfeita sempre que a
-- expressão avalia para NULL (não apenas para TRUE) — `char_length(btrim(null))
-- > 0` e `null >= 0` avaliam para NULL, nunca para FALSE.
alter table public.appointments alter column service_id drop not null;
alter table public.appointments alter column service_name_snapshot drop not null;
alter table public.appointments alter column value_cents_snapshot drop not null;

comment on column public.appointments.service_id is
  'Serviço do catálogo vinculado a este agendamento. Obrigatório quando '
  '`client_id` não é nulo (appointments_client_requires_service_check). '
  'Opcional quando `client_id` é nulo (DECISÃO DE PRODUTO 2026-08-18) — o '
  'prestador pode registrar um compromisso livre (ex.: "Reunião", "Almoço") '
  'só com `title`, sem selecionar nenhum serviço.';

-- RN final (ambas simultâneas, DECISÃO DE PRODUTO 2026-08-18):
--   client_id presente  -> service_id obrigatório (comportamento já existente,
--                          agora também garantido em constraint de banco, não
--                          só na RPC).
--   client_id ausente   -> title obrigatório; service_id livre (pode ou não
--                          vir preenchido).
alter table public.appointments
  add constraint appointments_client_or_title_check
  check (client_id is not null or title is not null);

alter table public.appointments
  add constraint appointments_client_requires_service_check
  check (client_id is null or service_id is not null);

-- Consistência interna: os três campos do "pacote de serviço" nascem e
-- morrem juntos — nunca um snapshot orfão de um `service_id` nulo, nem um
-- `service_id` preenchido sem os snapshots correspondentes.
alter table public.appointments
  add constraint appointments_service_snapshot_consistency_check
  check (
    (service_id is null and service_name_snapshot is null and value_cents_snapshot is null)
    or
    (service_id is not null and service_name_snapshot is not null and value_cents_snapshot is not null)
  );

-- Imutabilidade seletiva (DEC-065, mesmo padrão de tenant_id/client_id/
-- service_id já reforçado em enforce_appointments_immutable_columns):
-- `title` nasce com o compromisso e não é editável via `update_appointment`
-- — reescrever o assunto de um compromisso já criado é, na prática, um
-- compromisso novo, não uma remarcação (mesma decisão já registrada para
-- client_id/service_id em 20260806102200_appointment_rpcs.sql).
create or replace function public.enforce_appointments_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: tenant_id cannot be changed' using errcode = '22023';
  end if;
  if new.client_id is distinct from old.client_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: client_id cannot be changed' using errcode = '22023';
  end if;
  if new.service_id is distinct from old.service_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: service_id cannot be changed' using errcode = '22023';
  end if;
  if new.service_name_snapshot is distinct from old.service_name_snapshot then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: service_name_snapshot cannot be changed' using errcode = '22023';
  end if;
  if new.value_cents_snapshot is distinct from old.value_cents_snapshot then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: value_cents_snapshot cannot be changed' using errcode = '22023';
  end if;
  if new.title is distinct from old.title then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: title cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_group_id is distinct from old.recurrence_group_id then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_group_id cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_index is distinct from old.recurrence_index then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_index cannot be changed' using errcode = '22023';
  end if;
  if new.recurrence_count is distinct from old.recurrence_count then
    raise exception 'APPOINTMENT_IMMUTABLE_FIELD: recurrence_count cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- `appointments_client_view` (única forma de o cliente ler agendamentos):
-- `create or replace view` só permite ADICIONAR colunas ao final da lista de
-- projeção sem recriar o objeto (preserva `grant`/dependências) — `title`
-- entra no fim, depois de `updated_at`.
create or replace view public.appointments_client_view as
select
  a.id,
  a.tenant_id,
  a.client_id,
  a.service_id,
  a.service_name_snapshot,
  a.value_cents_snapshot,
  a.starts_at,
  a.timezone,
  a.duration_minutes,
  a.state,
  a.confirmation_status,
  a.confirmation_source,
  a.confirmed_at,
  a.client_message,
  a.cancellation_reason,
  a.cancelled_by,
  a.cancelled_at,
  a.recurrence_group_id,
  a.recurrence_index,
  a.recurrence_count,
  a.created_at,
  a.updated_at,
  a.title
from public.appointments a
join public.clients c on c.id = a.client_id
where c.client_user_id = auth.uid();

-- ============================================================================
-- 2) _create_appointment_row — título obrigatório sem cliente, serviço
--    obrigatório com cliente e opcional sem cliente
-- ============================================================================
--
-- Ponto de partida: corpo vigente em 20260817000100_fix_provider_
-- confirmation_source.sql (a última redefinição real desta função — inclui
-- `v_tenant_attendance_days`/`v_tenant_minimum_advance_hours` lidos de
-- `tenants` numa única query, e `confirmation_source = 'provider_manual'`
-- já corrigido). TODAS as regras já vigentes (bloqueio de agenda, dia de
-- atendimento, antecedência mínima configurável, limites do cliente,
-- `confirmation_source`) são preservadas exatamente como estão — só a
-- resolução de `title`/`service_id`/tenant (quando não há cliente) muda.
--
-- Assinatura: `p_title` é acrescentado como o ÚLTIMO parâmetro (com
-- default), preservando a ordem e os tipos dos 11 parâmetros já existentes
-- — mesma convenção adotada por TODAS as migrations anteriores desta série
-- para nunca precisar de `drop function` em cadeia. Ainda assim, como esta é
-- a primeira vez que o NÚMERO de parâmetros muda (não só o corpo), o `drop
-- function` explícito do signature antigo (11 args) é feito por segurança,
-- garantindo que nenhum overload de 11 argumentos fique órfão no catálogo.

drop function if exists public._create_appointment_row(
  uuid, uuid, uuid, timestamptz, text, integer, text, text, uuid, integer, integer
);

create function public._create_appointment_row(
  p_caller uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text,
  p_internal_notes text,
  p_recurrence_group_id uuid,
  p_recurrence_index integer,
  p_recurrence_count integer,
  p_title text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_client_user_id uuid;
  v_client_status client_status;
  v_client_total_limit integer;
  v_client_daily_limit integer;
  v_client_window_start date;
  v_client_window_end date;
  v_caller_role profile_role;
  v_requested_by appointment_actor;
  v_tenant_timezone text;
  v_tenant_attendance_days smallint[];
  v_tenant_minimum_advance_hours integer;
  v_service_name text;
  v_service_value_cents integer;
  v_ends_at timestamptz;
  v_minimum_instant timestamptz;
  v_local_date date;
  v_daily_count integer;
  v_total_count integer;
  v_confirmation_status appointment_confirmation_status;
  v_confirmation_source appointment_confirmation_source;
  v_confirmed_at timestamptz;
  v_row public.appointments;
begin
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'INVALID_DATE_TIME: duration must be a positive integer of minutes' using errcode = '22023';
  end if;

  -- RN final (DECISÃO DE PRODUTO 2026-08-18), checada o mais cedo possível:
  --   client_id presente -> service_id obrigatório.
  --   client_id ausente  -> title obrigatório (service_id passa a ser livre).
  if p_client_id is not null and p_service_id is null then
    raise exception 'SERVICE_REQUIRED: a service is required for appointments with a client' using errcode = '22023';
  end if;

  if p_client_id is null and btrim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED: title is required for appointments without a client' using errcode = '22023';
  end if;

  select role into v_caller_role from public.profiles where user_id = p_caller;

  if p_client_id is not null then
    select c.tenant_id, c.client_user_id, c.status, c.total_booking_limit, c.daily_booking_limit,
           c.request_window_start, c.request_window_end
      into v_tenant_id, v_client_user_id, v_client_status, v_client_total_limit, v_client_daily_limit,
           v_client_window_start, v_client_window_end
    from public.clients c
    where c.id = p_client_id;

    if not found then
      raise exception 'CLIENT_NOT_FOUND: client does not exist' using errcode = '22023';
    end if;

    if v_client_status <> 'active' then
      raise exception 'CLIENT_NOT_FOUND: client is not active' using errcode = '22023';
    end if;

    if v_caller_role = 'provider' then
      if not exists (
        select 1 from public.tenants t
        where t.id = v_tenant_id and t.owner_user_id = p_caller
      ) then
        raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
      end if;
      v_requested_by := 'provider';
    elsif v_caller_role = 'client' then
      if v_client_user_id is distinct from p_caller then
        raise exception 'FORBIDDEN: caller does not own this client record' using errcode = '42501';
      end if;
      if not exists (
        select 1 from public.provider_client_links l
        where l.tenant_id = v_tenant_id
          and l.client_user_id = p_caller
          and l.status = 'active'
      ) then
        raise exception 'CLIENT_LINK_INACTIVE: client link is not active' using errcode = '22023';
      end if;
      v_requested_by := 'client';
    else
      raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
    end if;
  else
    if v_caller_role = 'client' then
      raise exception 'FORBIDDEN: client callers must always provide their own client_id' using errcode = '42501';
    elsif v_caller_role <> 'provider' then
      raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
    end if;

    if p_service_id is not null then
      select s.tenant_id into v_tenant_id from public.services s where s.id = p_service_id;
      if not found then
        raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
      end if;
    else
      -- Compromisso livre (sem cliente e sem serviço, ex.: "Reunião",
      -- "Bloqueio pessoal"): não há mais nenhuma tabela de onde derivar
      -- `tenant_id` — só pode vir do próprio tenant do prestador chamador.
      select t.id into v_tenant_id from public.tenants t where t.owner_user_id = p_caller;
      if not found then
        raise exception 'FORBIDDEN: caller does not own an active tenant' using errcode = '42501';
      end if;
    end if;

    if not exists (
      select 1 from public.tenants t
      where t.id = v_tenant_id and t.owner_user_id = p_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;

    v_requested_by := 'provider';
  end if;

  select timezone, attendance_days, coalesce(minimum_advance_hours, 0)
    into v_tenant_timezone, v_tenant_attendance_days, v_tenant_minimum_advance_hours
  from public.tenants where id = v_tenant_id;
  if not found then
    raise exception 'FORBIDDEN: tenant not found' using errcode = '42501';
  end if;

  if p_timezone is distinct from v_tenant_timezone then
    raise exception 'INVALID_DATE_TIME: timezone must match the provider agenda timezone' using errcode = '22023';
  end if;

  -- Snapshot do serviço: só resolvido quando `p_service_id` foi informado.
  -- Sem cliente E sem serviço, nenhum valor/nome é inventado — os três
  -- campos ficam NULL (appointments_service_snapshot_consistency_check).
  if p_service_id is not null then
    select name, reference_value_cents into v_service_name, v_service_value_cents
    from public.services
    where id = p_service_id and tenant_id = v_tenant_id and status = 'active';

    if not found then
      raise exception 'SERVICE_NOT_FOUND: service does not exist or is not active for this provider' using errcode = '22023';
    end if;
  else
    v_service_name := null;
    v_service_value_cents := null;
  end if;

  v_ends_at := p_starts_at + (p_duration_minutes * interval '1 minute');

  -- Regras restritivas aplicadas SOMENTE ao CLIENTE no autoatendimento:
  if v_requested_by = 'client' then
    if exists (
      select 1 from public.availability_blocks b
      where b.tenant_id = v_tenant_id
        and p_starts_at < b.ends_at
        and v_ends_at > b.starts_at
    ) then
      raise exception 'AGENDA_BLOCKED: requested slot overlaps a provider availability block' using errcode = '22023';
    end if;

    if not (
      extract(dow from (p_starts_at at time zone v_tenant_timezone))::smallint
      = any(coalesce(v_tenant_attendance_days, array[0,1,2,3,4,5,6]::smallint[]))
    ) then
      raise exception 'ATTENDANCE_DAY_UNAVAILABLE: requested date falls outside the provider attendance days'
        using errcode = '22023';
    end if;

    v_minimum_instant := now() + (v_tenant_minimum_advance_hours * interval '1 hour');
    if p_starts_at < v_minimum_instant then
      raise exception 'ADVANCE_NOTICE_INVALID: minimum advance notice not met' using errcode = '22023';
    end if;

    v_local_date := (p_starts_at at time zone v_tenant_timezone)::date;

    if v_client_window_start is not null
       and (v_local_date < v_client_window_start or v_local_date > v_client_window_end)
    then
      raise exception 'OUTSIDE_ALLOWED_PERIOD: requested date is outside the allowed window' using errcode = '22023';
    end if;

    if v_client_daily_limit is not null then
      select count(*) into v_daily_count
      from public.appointments a
      where a.client_id = p_client_id
        and a.state <> 'cancelled'
        and (a.starts_at at time zone v_tenant_timezone)::date = v_local_date;

      if v_daily_count >= v_client_daily_limit then
        raise exception 'DAILY_LIMIT_REACHED: daily booking limit reached for this client' using errcode = '22023';
      end if;
    end if;

    if v_client_total_limit is not null then
      select count(*) into v_total_count
      from public.appointments a
      where a.client_id = p_client_id
        and a.state <> 'cancelled';

      if v_total_count >= v_client_total_limit then
        raise exception 'TOTAL_LIMIT_REACHED: total booking limit reached for this client' using errcode = '22023';
      end if;
    end if;
  end if;

  if v_requested_by = 'provider' then
    v_confirmation_status := 'confirmed';
    v_confirmation_source := 'provider_manual';
    v_confirmed_at := now();
  else
    v_confirmation_status := 'pending';
    v_confirmation_source := null;
    v_confirmed_at := null;
  end if;

  begin
    insert into public.appointments (
      tenant_id, client_id, service_id, service_name_snapshot, value_cents_snapshot,
      starts_at, timezone, duration_minutes, state, confirmation_status,
      confirmation_source, confirmed_at, client_message, internal_notes,
      recurrence_group_id, recurrence_index, recurrence_count, title
    )
    values (
      v_tenant_id, p_client_id, p_service_id, v_service_name, v_service_value_cents,
      p_starts_at, p_timezone, p_duration_minutes, 'scheduled', v_confirmation_status,
      v_confirmation_source, v_confirmed_at, p_client_message, p_internal_notes,
      p_recurrence_group_id, p_recurrence_index, p_recurrence_count, p_title
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: requested slot overlaps an existing appointment' using errcode = '23P01';
  end;

  return v_row;
end;
$$;

revoke all on function public._create_appointment_row(
  uuid, uuid, uuid, timestamptz, text, integer, text, text, uuid, integer, integer, text
) from public, anon, authenticated;

-- ============================================================================
-- 3) create_appointment — acrescenta p_title (corpo vigente: 20260806102200)
-- ============================================================================

drop function if exists public.create_appointment(uuid, uuid, timestamptz, text, integer, text, text);

create function public.create_appointment(
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text default null,
  p_internal_notes text default null,
  p_title text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  -- RN-OBS-010: internal_notes é exclusivo do prestador. Validado ANTES de
  -- chamar a função interna (que não repete esta checagem de papel para
  -- este campo específico).
  if p_internal_notes is not null and not exists (
    select 1 from public.profiles where user_id = v_caller and role = 'provider'
  ) then
    raise exception 'FORBIDDEN: only the provider can set internal notes' using errcode = '42501';
  end if;

  v_row := public._create_appointment_row(
    v_caller, p_client_id, p_service_id, p_starts_at, p_timezone, p_duration_minutes,
    p_client_message, p_internal_notes, null, null, null, p_title
  );

  return v_row;
end;
$$;

revoke all on function public.create_appointment(uuid, uuid, timestamptz, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_appointment(uuid, uuid, timestamptz, text, integer, text, text, text)
  to authenticated;

-- ============================================================================
-- 4) create_recurring_appointments — acrescenta p_title (corpo vigente:
--    20260806102200)
-- ============================================================================

drop function if exists public.create_recurring_appointments(
  uuid, uuid, timestamptz, text, integer, text, text, text, integer, timestamptz[]
);

create function public.create_recurring_appointments(
  p_client_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_timezone text,
  p_duration_minutes integer,
  p_client_message text default null,
  p_internal_notes text default null,
  p_frequency text default null,
  p_occurrences integer default null,
  p_dates timestamptz[] default null,
  p_title text default null
)
returns setof public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_group_id uuid := gen_random_uuid();
  v_occurrence_starts timestamptz[];
  v_count integer;
  v_step interval;
  v_current timestamptz;
  v_row public.appointments;
  i integer;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  if p_internal_notes is not null and not exists (
    select 1 from public.profiles where user_id = v_caller and role = 'provider'
  ) then
    raise exception 'FORBIDDEN: only the provider can set internal notes' using errcode = '42501';
  end if;

  if p_dates is not null then
    v_occurrence_starts := p_dates;
  elsif p_frequency is not null and p_occurrences is not null then
    v_step := case p_frequency
      when 'weekly' then interval '7 days'
      when 'biweekly' then interval '14 days'
      when 'monthly' then interval '1 month'
      else null
    end;

    if v_step is null then
      raise exception 'INVALID_DATE_TIME: frequency must be weekly, biweekly or monthly' using errcode = '22023';
    end if;

    v_occurrence_starts := array[]::timestamptz[];
    v_current := p_starts_at;
    for i in 1..p_occurrences loop
      v_occurrence_starts := array_append(v_occurrence_starts, v_current);
      v_current := v_current + v_step;
    end loop;
  else
    raise exception 'INVALID_DATE_TIME: recurrence must define frequency+occurrences or an explicit list of dates'
      using errcode = '22023';
  end if;

  v_count := coalesce(array_length(v_occurrence_starts, 1), 0);

  if v_count < 2 or v_count > 24 then
    raise exception 'INVALID_DATE_TIME: recurrence must contain between 2 and 24 occurrences' using errcode = '22023';
  end if;

  for i in 1..v_count loop
    v_row := public._create_appointment_row(
      v_caller, p_client_id, p_service_id, v_occurrence_starts[i], p_timezone, p_duration_minutes,
      p_client_message, p_internal_notes, v_group_id, i, v_count, p_title
    );
    return next v_row;
  end loop;

  return;
end;
$$;

revoke all on function public.create_recurring_appointments(
  uuid, uuid, timestamptz, text, integer, text, text, text, integer, timestamptz[], text
) from public, anon, authenticated;
grant execute on function public.create_recurring_appointments(
  uuid, uuid, timestamptz, text, integer, text, text, text, integer, timestamptz[], text
) to authenticated;

-- ============================================================================
-- 5) update_appointment — NENHUMA alteração de código nesta migration
-- ============================================================================
--
-- `update_appointment` (última redefinição real: 20260816235000_provider_
-- unrestricted_advance_notice.sql) nunca recebeu `client_id`/`service_id`
-- como parâmetro e nunca escreve essas colunas no seu `update ... set` — a
-- proteção "edição posterior não remove o serviço de um agendamento que tem
-- cliente" já é garantida estruturalmente por DUAS camadas independentes,
-- nenhuma delas tocada aqui:
--   1. O trigger `enforce_appointments_immutable_columns` (redefinido acima
--      só para acrescentar `title`) bloqueia qualquer UPDATE que mude
--      `client_id`/`service_id`, ainda que alguém tentasse via SQL direto.
--   2. `update_appointment` não expõe `p_client_id`/`p_service_id` como
--      parâmetro — não há caminho de chamada que tente essa mudança.
-- `title` recebe a MESMA proteção (item 1, acrescentado agora) e a MESMA
-- ausência de parâmetro em `update_appointment` (nunca existiu, então nada
-- precisa ser removido). Nenhuma alteração de assinatura ou corpo desta
-- função é necessária.

-- ============================================================================
-- Testes executados na própria migration (mesmo padrão de todas as
-- anteriores desta série) — verificações estruturais apenas; migration NÃO
-- executada contra um Postgres real neste ambiente (Docker inacessível ao
-- sandbox, mesma limitação já registrada em BLG-050/DEC-073).
-- ============================================================================

do $$
declare
  v_is_nullable text;
  v_constraint_count integer;
  v_source text;
begin
  select is_nullable into v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'appointments' and column_name = 'title';
  assert v_is_nullable = 'YES', 'appointments.title deveria ser nullable (obrigatoriedade é condicional, via CHECK)';

  select is_nullable into v_is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'appointments' and column_name = 'service_id';
  assert v_is_nullable = 'YES', 'appointments.service_id deveria ser nullable após esta migration';

  select count(*) into v_constraint_count
  from pg_constraint
  where conrelid = 'public.appointments'::regclass
    and conname in (
      'appointments_title_not_blank_check',
      'appointments_client_or_title_check',
      'appointments_client_requires_service_check',
      'appointments_service_snapshot_consistency_check'
    );
  assert v_constraint_count = 4, 'as 4 constraints novas de title/service_id deveriam existir em appointments';

  select prosrc into v_source
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = '_create_appointment_row';
  assert v_source like '%TITLE_REQUIRED%', '_create_appointment_row deveria conter a checagem TITLE_REQUIRED';
  assert v_source like '%SERVICE_REQUIRED%', '_create_appointment_row deveria conter a checagem SERVICE_REQUIRED';

  select count(*) into v_constraint_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'appointments_client_view' and column_name = 'title';
  assert v_constraint_count = 1, 'appointments_client_view deveria expor a coluna title';

  raise notice 'appointment_title_optional_service: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;
