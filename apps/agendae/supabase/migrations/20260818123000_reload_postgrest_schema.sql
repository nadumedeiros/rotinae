-- Recarrega o cache de schema do PostgREST após a alteração das assinaturas
-- das RPCs de agendamento comum e recorrente.
notify pgrst, 'reload schema';
