-- ============================================================================
-- revert_appointment_to_scheduled — reverter agendamento terminal para
-- "scheduled" (bug report 2026-08-23: hoje NÃO existe nenhum caminho de volta
-- depois que um agendamento chega a completed/cancelled/no_show).
-- ============================================================================
--
-- CONTEXTO: `INVALID_STATE_TRANSITION: terminal appointments cannot be
-- updated`, lançado por `update_appointment` desde
-- 20260806102200_appointment_rpcs.sql (mantido em todas as redefinições
-- posteriores, incluindo a vigente em 20260819100000_provider_plan_horizon_
-- limit.sql), é uma decisão de design deliberada — "um registro em estado
-- terminal é histórico, não deveria voltar a mudar de horário ou de
-- mensagem" — não uma regressão. Nunca existiu, porém, NENHUM caminho para
-- desfazer um estado terminal alcançado por engano (ex.: prestador marcou
-- "Concluído"/"Cancelado" no agendamento errado). Esta migration fecha essa
-- lacuna com uma função NOVA e dedicada, em vez de reabrir `update_appointment`
-- (que continua bloqueando qualquer edição de registro terminal para todos os
-- outros campos — nenhuma mudança de comportamento ali).
--
-- DECISÃO DE DESIGN — função dedicada, não uma extensão de update_appointment/
-- cancel_appointment:
-- 1) `update_appointment` tem um bloqueio de estado terminal genérico e
--    propositalmente amplo (linha "if v_current_state in ('completed',
--    'cancelled', 'no_show') then raise INVALID_STATE_TRANSITION"); ensartar
--    uma exceção pontual ali significaria reescrever essa checagem para
--    todos os chamadores, aumentando a superfície de regressão de uma função
--    já complexa (checagem de horizonte de plano, política de cliente,
--    remarcação). `cancel_appointment` só sabe fazer uma transição (para
--    `cancelled`) e sua idempotência para "já cancelado" tornaria confuso
--    reaproveitá-la para o sentido inverso.
-- 2) Uma função nova, curta e de responsabilidade única é mais fácil de
--    auditar e de restringir (só o prestador, só a transição terminal ->
--    scheduled) sem tocar em nenhum caminho existente — mesmo racional de
--    `confirm_appointment_manually` ser separada de `update_appointment`.
--
-- AUTORIZAÇÃO: só o PRESTADOR dono do tenant do agendamento pode reverter —
-- mesmo padrão de checagem de posse de `confirm_appointment_manually`
-- (tenant.owner_user_id = auth.uid()). O cliente nunca tem esta opção: não
-- existe nenhum ramo de `v_caller_role = 'client'` nesta função (diferente de
-- `update_appointment`/`cancel_appointment`, que atendem os dois papéis) —
-- qualquer chamador que não seja o dono do tenant cai direto em FORBIDDEN.
--
-- REVALIDAÇÃO DE CONFLITO DE HORÁRIO: a exclusion constraint
-- `appointments_no_overlap_exclude` (20260806102100_appointments.sql) já
-- exclui `state <> 'cancelled'` — ou seja, um agendamento `completed`/
-- `no_show` sempre ocupou o próprio slot perante essa constraint (nenhuma
-- outra linha ativa pode tê-lo sobreposto enquanto ele existia nesse estado),
-- e um agendamento `cancelled` LIBEROU o slot no momento do cancelamento,
-- podendo ter sido ocupado por outro agendamento desde então. Reverter para
-- `scheduled` faz esta linha voltar a competir pela constraint: o `UPDATE`
-- abaixo é automaticamente checado pelo Postgres contra todas as outras
-- linhas `state <> 'cancelled'` do mesmo tenant, e um `exclusion_violation`
-- é capturado e relançado como `SLOT_UNAVAILABLE` — mesmo contrato de erro já
-- usado por `_create_appointment_row`/`update_appointment`. Nenhuma checagem
-- manual de overlap é necessária: o mecanismo é o mesmo já usado em toda
-- escrita de `appointments`, não um caminho paralelo.
--
-- ESTADO RESULTANTE: reaproveita exatamente a mesma convenção já usada
-- quando `v_requested_by = 'provider'` em `_create_appointment_row`
-- (`confirmation_status = 'confirmed'`, `confirmation_source =
-- 'provider_manual'`, `confirmed_at = now()`) — a reversão é sempre uma ação
-- do prestador, nunca do cliente, então não há ambiguidade de qual dos dois
-- valores de `ConfirmationSource` usar. Os campos de cancelamento
-- (`cancelled_by`/`cancelled_at`/`cancellation_reason`) são limpos porque
-- `appointments_cancellation_consistency_check` (20260806102100) EXIGE que
-- os três sejam `null` sempre que `state <> 'cancelled'` — sem isso o UPDATE
-- falharia com violação de check constraint para o caso `cancelled ->
-- scheduled`.
--
-- ESCOPO explicitamente FORA desta migration: nenhum botão/menu em
-- `app/agenda.tsx`/`app/clients/[id].tsx` — só o RPC e o método
-- correspondente em `supabase-appointment-adapter.ts`
-- (`revertToScheduled`), documentado para o frontend consumir depois.
--
-- Depende de: 20260806102100_appointments.sql (tabela, exclusion constraint,
-- constraint de consistência de cancelamento), 20260806102200_appointment_rpcs.sql
-- (padrão de checagem de posse/erro), 20260819100000_provider_plan_horizon_
-- limit.sql (última redefinição de update_appointment, preservada sem
-- alteração — esta migration não a toca).

create or replace function public.revert_appointment_to_scheduled(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_current_state appointment_state;
  v_starts_at timestamptz;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.tenant_id, a.state, a.starts_at
    into v_tenant_id, v_current_state, v_starts_at
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  -- Só o PRESTADOR dono do tenant reverte — nenhum ramo de cliente existe
  -- nesta função (ver nota de topo).
  if not exists (
    select 1 from public.tenants t
    where t.id = v_tenant_id and t.owner_user_id = v_caller
  ) then
    raise exception 'FORBIDDEN: only the provider can revert a terminal appointment to scheduled'
      using errcode = '42501';
  end if;

  if v_current_state not in ('completed', 'cancelled', 'no_show') then
    raise exception 'INVALID_STATE_TRANSITION: only completed, cancelled or no_show appointments can be reverted to scheduled'
      using errcode = '22023';
  end if;

  begin
    update public.appointments
    set state = 'scheduled',
        confirmation_status = 'confirmed',
        confirmation_source = 'provider_manual',
        confirmed_at = now(),
        cancellation_reason = null,
        cancelled_by = null,
        cancelled_at = null
    where id = p_id
    returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE: requested slot is already booked for this provider (%)', v_starts_at
        using errcode = '22023';
  end;

  return v_row;
end;
$$;

revoke all on function public.revert_appointment_to_scheduled(uuid) from public, anon, authenticated;
grant execute on function public.revert_appointment_to_scheduled(uuid) to authenticated;

-- ============================================================================
-- Verificação estrutural (mesmo padrão de outras migrations desta série,
-- ex.: 20260814110000/20260819100000) — checagens de definição de função,
-- sem depender de sessão/JWT real.
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'revert_appointment_to_scheduled';

  assert v_definition like '%INVALID_STATE_TRANSITION%',
    'revert_appointment_to_scheduled deveria lançar INVALID_STATE_TRANSITION para estados não terminais';
  assert v_definition like '%SLOT_UNAVAILABLE%',
    'revert_appointment_to_scheduled deveria lançar SLOT_UNAVAILABLE quando o slot for revalidado e estiver ocupado';
  assert v_definition like '%exclusion_violation%',
    'revert_appointment_to_scheduled deveria capturar exclusion_violation para revalidar o slot';
  assert v_definition like '%owner_user_id%',
    'revert_appointment_to_scheduled deveria checar posse do tenant (só o prestador reverte)';
  assert v_definition not like '%client_user_id%',
    'revert_appointment_to_scheduled nunca deveria ter um caminho de autorização para o cliente';
  assert v_definition like '%cancelled_by = null%' or v_definition like '%cancelled_by=null%'
      or v_definition like '%cancelled_by%null%',
    'revert_appointment_to_scheduled deveria limpar cancelled_by ao reverter (appointments_cancellation_consistency_check)';

  -- Só authenticated tem EXECUTE; anon/public seguem sem acesso algum
  -- (mesma auditoria estrutural feita para as demais RPCs desta série).
  assert has_function_privilege('authenticated', 'public.revert_appointment_to_scheduled(uuid)', 'execute'),
    'authenticated deveria poder executar revert_appointment_to_scheduled';
  assert not has_function_privilege('anon', 'public.revert_appointment_to_scheduled(uuid)', 'execute'),
    'anon NUNCA deveria poder executar revert_appointment_to_scheduled';

  raise notice 'revert_terminal_appointment_to_scheduled: verificações estruturais passaram.';
end $$;
