-- Publica a versão jurídica exibida no cadastro. O conteúdo integral vive na
-- aplicação; esta tabela registra a versão inequívoca aceita pelo usuário.
-- Uma única versão ativa por tipo evita aceite ambíguo no trigger de signup.

update public.legal_documents
set status = 'retired'
where kind in ('terms', 'privacy_policy')
  and status = 'active'
  and version <> '2026-08-04';

insert into public.legal_documents (kind, version, effective_at, status)
values
  ('terms', '2026-08-04', now(), 'active'),
  ('privacy_policy', '2026-08-04', now(), 'active')
on conflict (kind, version) do update
set effective_at = excluded.effective_at,
    status = 'active';

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.legal_documents
  where version = '2026-08-04'
    and status = 'active'
    and kind in ('terms', 'privacy_policy');

  if v_count <> 2 then
    raise exception 'LEGAL_DOCUMENT_PUBLICATION_FAILED: expected 2 active documents, found %', v_count;
  end if;
end;
$$;
