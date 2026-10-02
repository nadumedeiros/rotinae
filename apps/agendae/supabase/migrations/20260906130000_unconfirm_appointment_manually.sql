-- ============================================================================
-- unconfirm_appointment_manually — reverter um agendamento "Confirmado" de
-- volta para "A confirmar" (bug relatado pelo usuário, 06/09/2026)
-- ============================================================================
--
-- CONTEXTO: o seletor de "Situação" dentro do formulário de edição de
-- agendamento (`app/agenda.tsx`) sempre permitiu escolher "A confirmar" para
-- um agendamento já `Confirmado`, mas não existia NENHUM caminho de volta —
-- só `confirm_appointment_manually` (sempre para frente, "A confirmar" ->
-- "Confirmado"). O prestador selecionava "A confirmar", salvava, e a tabela
-- continuava mostrando "Confirmado" (nenhuma chamada de rede desfazia a
-- confirmação). Esta migration fecha essa lacuna com uma função dedicada,
-- espelhando exatamente `confirm_appointment_manually` (mesmo racional de
-- responsabilidade única já usado por `revert_appointment_to_scheduled`,
-- 20260823120000, para o caso terminal->scheduled).
--
-- AUTORIZAÇÃO: só o PRESTADOR dono do tenant do agendamento pode reverter a
-- confirmação — mesmo padrão de posse de `confirm_appointment_manually`
-- (tenant.owner_user_id = auth.uid()). Não há ramo de cliente: o cliente
-- nunca desfaz uma confirmação (nem a sua própria, nasce confirmada por
-- RN-AGD-014; nem uma manual do prestador).
--
-- ESCOPO: só agendamentos `scheduled` podem ter a confirmação revertida
-- (mesmo bloqueio de `confirm_appointment_manually` — um registro terminal
-- é histórico). Idempotente para "já pendente" (mesmo padrão de
-- `confirm_appointment_manually` para "já confirmado"): nunca lança erro,
-- devolve o registro como está.
create or replace function public.unconfirm_appointment_manually(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_client_tenant_id uuid;
  v_current_confirmation appointment_confirmation_status;
  v_current_state appointment_state;
  v_row public.appointments;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select a.tenant_id, a.confirmation_status, a.state
    into v_client_tenant_id, v_current_confirmation, v_current_state
  from public.appointments a
  where a.id = p_id
  for update of a;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND: appointment does not exist' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.tenants t where t.id = v_client_tenant_id and t.owner_user_id = v_caller
  ) then
    raise exception 'FORBIDDEN: only the provider can revert a manual confirmation' using errcode = '42501';
  end if;

  if v_current_state <> 'scheduled' then
    raise exception 'INVALID_STATE_TRANSITION: only scheduled appointments can have their confirmation reverted' using errcode = '22023';
  end if;

  if v_current_confirmation = 'pending' then
    select * into v_row from public.appointments where id = p_id;
    return v_row;
  end if;

  update public.appointments
  set confirmation_status = 'pending',
      confirmation_source = null,
      confirmed_at = null
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.unconfirm_appointment_manually(uuid) from public, anon, authenticated;
grant execute on function public.unconfirm_appointment_manually(uuid) to authenticated;

-- ============================================================================
-- Verificação estrutural (mesmo padrão de 20260823120000)
-- ============================================================================

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into strict v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'unconfirm_appointment_manually';

  assert v_definition like '%INVALID_STATE_TRANSITION%',
    'unconfirm_appointment_manually deveria lançar INVALID_STATE_TRANSITION para estados não scheduled';
  assert v_definition like '%owner_user_id%',
    'unconfirm_appointment_manually deveria checar posse do tenant (só o prestador reverte)';
  assert v_definition not like '%client_user_id%',
    'unconfirm_appointment_manually nunca deveria ter um caminho de autorização para o cliente';
  assert v_definition like '%confirmation_status = ''pending''%',
    'unconfirm_appointment_manually deveria gravar confirmation_status = pending';

  assert has_function_privilege('authenticated', 'public.unconfirm_appointment_manually(uuid)', 'execute'),
    'authenticated deveria poder executar unconfirm_appointment_manually';
  assert not has_function_privilege('anon', 'public.unconfirm_appointment_manually(uuid)', 'execute'),
    'anon NUNCA deveria poder executar unconfirm_appointment_manually';

  raise notice 'unconfirm_appointment_manually: verificações estruturais passaram.';
end $$;
