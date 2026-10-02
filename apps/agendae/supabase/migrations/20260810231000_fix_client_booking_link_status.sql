-- Corrige o valor do enum link_status usado pelo contexto de agendamento.
-- A definição completa permanece versionada na migration imediatamente anterior.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.get_client_booking_context(text)'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition, 'l.status = ''accepted''', 'l.status = ''active''');
  execute v_definition;
end;
$$;
