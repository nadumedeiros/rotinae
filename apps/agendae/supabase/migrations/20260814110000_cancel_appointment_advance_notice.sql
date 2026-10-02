-- ============================================================================
-- cancel_appointment — antecedência mínima de 24h para cancelamento pelo
-- cliente (RN-CAN-009 revisada por DEC-150, RN-CAN-015/016, RF-CAN-007/008,
-- BLG-092).
-- ============================================================================
--
-- CONTEXTO: RN-CAN-009 foi revisada (DEC-150) — o cliente deixou de poder
-- cancelar "até imediatamente antes do horário inicial" (regra original de
-- DEC-146) e passa a exigir antecedência mínima de 24 HORAS CORRIDAS
-- (`starts_at - now() >= interval '24 hours'`), instante absoluto e
-- fuso-agnóstico. Deliberadamente distinta do "dia útil" de RN-AGD-004/008/
-- 009 (`minimum_bookable_instant`, usado só na CRIAÇÃO/remarcação do
-- agendamento) — nenhuma reutilização daquela função aqui.
--
-- RN-CAN-010 permanece inalterada: o cancelamento PELO PRESTADOR continua
-- sem qualquer restrição de antecedência mínima. A checagem abaixo só se
-- aplica quando `v_actor = 'client'`.
--
-- RN-CAN-015: defesa em profundidade — esta é a metade SERVER-SIDE (a
-- metade client-side fica a cargo da ADA em `client-home.tsx`, ver
-- `docs/HANDOFF_CANCELAMENTO_CLIENTE_UX_DANTE.md`, seção 13). O servidor é
-- o gate que efetivamente importa; nada nesta função depende do cálculo
-- feito na tela.
--
-- RN-CAN-016: cálculo exato da janela — `>= 24h` é permitido, `< 24h` é
-- bloqueado (limite inclusivo do lado permitido). Ex.: faltando exatamente
-- 24h00min, o cancelamento é aceito; faltando 23h59min59s, é rejeitado.
--
-- Código de erro NOVO, distinto de todos os já existentes em
-- `AppointmentErrorCode` (`APPOINTMENT_NOT_FOUND`, `FORBIDDEN`,
-- `INVALID_STATE_TRANSITION`, etc.): `CANCELLATION_ADVANCE_NOTICE_INVALID`,
-- mesmo padrão `CODIGO: descrição` já usado por todas as demais RPCs deste
-- projeto (`extractPrefixCode` em `supabase-appointment-adapter.ts`).
--
-- ORDEM DAS DUAS CHECAGENS DE JANELA (ambas exclusivas de `v_actor =
-- 'client'`, preservando a ordem já existente antes desta migration):
-- 1) `v_starts_at <= now()` (RN-CAN-006/pré-existente): atendimento cujo
--    horário JÁ COMEÇOU — erro `INVALID_STATE_TRANSITION`, inalterado.
-- 2) `v_starts_at - now() < interval '24 hours'` (NOVA, RN-CAN-009/015/016):
--    atendimento que ainda não começou mas está dentro da janela de 24h —
--    erro `CANCELLATION_ADVANCE_NOTICE_INVALID`.
-- A checagem (1) é estritamente mais específica que a (2) — todo caso que
-- cai em (1) também cairia em (2), já que `starts_at <= now()` implica
-- `starts_at - now() <= 0 < 24h`. Mantê-la ANTES da checagem nova preserva
-- o código de erro mais específico (`INVALID_STATE_TRANSITION`) para quem
-- tenta cancelar um atendimento cujo horário já passou, em vez de mascarar
-- esse caso com a mensagem genérica de antecedência mínima — nenhuma
-- mudança de comportamento para esse cenário específico.
--
-- Depende de: 20260806102200_appointment_rpcs.sql (versão original de
-- `cancel_appointment`), 20260812140000_appointments_optional_client.sql
-- (última redefinição efetiva antes desta migration — tenant_id lido
-- diretamente de `appointments`, não mais via `clients`).
--
-- Escopo explicitamente FORA desta migration: wiring de frontend
-- (`client-home.tsx`, botão/modal de dois estados, tratamento do erro no
-- adapter) — fica para a ADA, conforme `docs/HANDOFF_CANCELAMENTO_CLIENTE_
-- UX_DANTE.md` seção 13 e `BLG-092`. Este arquivo só altera o mapeamento de
-- erro do adaptador (`ERROR_MESSAGES`/`AppointmentErrorCode`), que não é
-- schema/RPC.

create or replace function public.cancel_appointment(p_id uuid, p_reason text default null)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role profile_role;
  v_client_id uuid;
  v_client_tenant_id uuid;
  v_client_user_id uuid;
  v_current_state appointment_state;
  v_starts_at timestamptz;
  v_actor appointment_actor;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.client_id, a.tenant_id, a.state, a.starts_at
    into v_client_id, v_client_tenant_id, v_current_state, v_starts_at
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  if v_client_id is not null then
    select c.client_user_id into v_client_user_id
    from public.clients c where c.id = v_client_id;
  end if;

  select role into v_caller_role from public.profiles where user_id = v_caller;

  if v_caller_role = 'provider' then
    if not exists (
      select 1 from public.tenants t where t.id = v_client_tenant_id and t.owner_user_id = v_caller
    ) then
      raise exception 'FORBIDDEN: caller does not own this tenant' using errcode = '42501';
    end if;
    v_actor := 'provider';
  elsif v_caller_role = 'client' then
    if v_client_user_id is distinct from v_caller then
      raise exception 'FORBIDDEN: caller does not own this appointment' using errcode = '42501';
    end if;
    v_actor := 'client';
  else
    raise exception 'FORBIDDEN: caller has no recognized role' using errcode = '42501';
  end if;

  -- Idempotência: recancelar não é erro nem reescreve motivo/ator/data já
  -- gravados (RN-CAN-004/005 preservam o registro cancelado como está).
  if v_current_state = 'cancelled' then
    select * into v_row from public.appointments where id = p_id;
    return v_row;
  end if;

  -- RN-CAN-006.
  if v_current_state in ('completed', 'no_show') then
    raise exception 'INVALID_STATE_TRANSITION: completed or no_show appointments cannot be cancelled'
      using errcode = '22023';
  end if;

  -- RN-CAN-006 (pré-existente, inalterada): depois que o horário começou,
  -- só o prestador decide o desfecho (completed/no_show) — o cliente não
  -- cancela mais por aqui.
  if v_actor = 'client' and v_starts_at <= now() then
    raise exception 'INVALID_STATE_TRANSITION: client cannot cancel after the appointment has started'
      using errcode = '22023';
  end if;

  -- RN-CAN-009 (revisada por DEC-150), RN-CAN-015/016 (NOVA nesta migration):
  -- o cliente só pode cancelar com antecedência mínima de 24 horas CORRIDAS,
  -- instante absoluto, fuso-agnóstico. O prestador (RN-CAN-010) permanece
  -- sem qualquer restrição de antecedência.
  if v_actor = 'client' and (v_starts_at - now()) < interval '24 hours' then
    raise exception 'CANCELLATION_ADVANCE_NOTICE_INVALID: client cancellation requires at least 24 hours of advance notice'
      using errcode = '22023';
  end if;

  update public.appointments
  set state = 'cancelled',
      cancellation_reason = p_reason,
      cancelled_by = v_actor,
      cancelled_at = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.cancel_appointment(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;

-- ============================================================================
-- Verificação estrutural apenas (mesmo padrão de
-- `20260814100000_dashboard_today_appointments_exclude_past.sql`) —
-- migration NÃO executada contra um Postgres real neste ambiente (Docker
-- inacessível ao sandbox, mesma limitação já registrada em BLG-050/DEC-073).
-- Cenários de sessão/autorização/janela de 24h são cobertos pelos testes de
-- TypeScript do adapter com o cliente Supabase mockado.
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cancel_appointment';

  assert v_definition like '%CANCELLATION_ADVANCE_NOTICE_INVALID%',
    'cancel_appointment deveria lançar CANCELLATION_ADVANCE_NOTICE_INVALID';

  assert v_definition like '%v_actor = ''client'' and (v_starts_at - now()) < interval ''24 hours''%',
    'cancel_appointment deveria checar antecedência mínima de 24h somente para o ator client';

  -- A checagem pré-existente de "já começou" precisa continuar antes da
  -- checagem nova, na ordem exata do arquivo-fonte (ver nota de topo) — uma
  -- comparação de posição confirma que a checagem de INVALID_STATE_TRANSITION
  -- aparece antes da checagem de CANCELLATION_ADVANCE_NOTICE_INVALID.
  assert position('client cannot cancel after the appointment has started' in v_definition)
      < position('CANCELLATION_ADVANCE_NOTICE_INVALID' in v_definition),
    'a checagem de atendimento já iniciado deveria continuar antes da checagem de antecedência mínima';

  raise notice 'cancel_appointment_advance_notice: verificações estruturais passaram (sem execução contra Postgres real).';
end $$;

-- ============================================================================
-- Teste de regressão da ARITMÉTICA da janela de 24h (RN-CAN-016), isolado da
-- checagem de sessão/autorização (`auth.uid()`), que só existe num Postgres
-- com PostgREST/GoTrue por trás — mesma limitação de ambiente já registrada
-- acima. Reproduz EXATAMENTE a expressão usada dentro de `cancel_appointment`
-- (`(v_starts_at - now()) < interval '24 hours'`), substituindo `now()` por
-- um instante de referência fixo para eliminar qualquer flakiness de tempo
-- real decorrido entre o cálculo de `v_starts_at` e a avaliação do `assert`.
-- ============================================================================

do $$
declare
  v_ref timestamptz := '2026-01-01T00:00:00Z';
  v_starts_at timestamptz;
begin
  -- Exatamente 24h00min00s de antecedência: limite INCLUSIVO do lado
  -- permitido (RN-CAN-016) — não deveria ser bloqueado.
  v_starts_at := v_ref + interval '24 hours';
  assert not ((v_starts_at - v_ref) < interval '24 hours'),
    'exatamente 24h de antecedência não deveria ser bloqueado (limite inclusivo)';

  -- 24h00min01s de antecedência: folga clara acima do limite, não bloqueado.
  v_starts_at := v_ref + interval '24 hours' + interval '1 second';
  assert not ((v_starts_at - v_ref) < interval '24 hours'),
    '24h00min01s de antecedência não deveria ser bloqueado';

  -- 23h59min59s de antecedência: 1 segundo abaixo do limite, DEVE ser
  -- bloqueado — este é o caso de off-by-one que a suíte de regressão
  -- (BLG-092) precisa cobrir.
  v_starts_at := v_ref + interval '23 hours 59 minutes 59 seconds';
  assert ((v_starts_at - v_ref) < interval '24 hours'),
    '23h59min59s de antecedência deveria ser bloqueado (abaixo do mínimo de 24h)';

  -- Antecedência muito curta (1 minuto) e negativa (atendimento já
  -- começou): ambas claramente abaixo de 24h, devem ser bloqueadas pela
  -- mesma expressão (o caso "já começou" é interceptado antes, com um
  -- código de erro diferente — ver checagem de posição no bloco anterior —
  -- mas a expressão de 24h em si também os classificaria como bloqueados,
  -- não há sobreposição incoerente entre as duas checagens).
  v_starts_at := v_ref + interval '1 minute';
  assert ((v_starts_at - v_ref) < interval '24 hours'),
    '1 minuto de antecedência deveria ser bloqueado';

  v_starts_at := v_ref - interval '10 minutes';
  assert ((v_starts_at - v_ref) < interval '24 hours'),
    'atendimento já iniciado (antecedência negativa) deveria ser classificado como bloqueado pela expressão de 24h';

  raise notice 'cancel_appointment_advance_notice: teste de regressão da aritmética de 24h (limite exato, off-by-one) passou.';
end $$;
