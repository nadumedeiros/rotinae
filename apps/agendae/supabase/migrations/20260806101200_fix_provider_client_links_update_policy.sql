-- Etapa 1 — correção de achado de auditoria de segurança (DEC-065).
--
-- Achado: a policy "provider_client_links_update_owner" (ver
-- 20260806100300_provider_client_links.sql) autoriza o proprietário do
-- tenant a dar UPDATE na linha, mas as clausulas `using`/`with check`
-- só reavaliam "o tenant é meu?" — elas não restringem QUAIS colunas podem
-- mudar. O trigger `provider_client_links_transition` só valida a máquina
-- de estados quando a coluna `status` é alterada (`before update of
-- status`). Logo, um UPDATE que troque `client_user_id`, `requested_at`,
-- `decided_at`, `decided_by` ou `revoked_by` sem tocar `status` passava sem
-- qualquer validação — permitindo, por exemplo, reatribuir um vínculo a
-- outro cliente sem novo consentimento, ou adulterar retroativamente quem/
-- quando decidiu.
--
-- Por que a correção não é feita só com `with check`: policies RLS não têm
-- acesso ao valor antigo da linha (`old`) fora do contexto de um trigger —
-- `using`/`with check` só veem a linha candidata (`new`, implicitamente) no
-- momento da avaliação, sem uma forma nativa de compará-la com o estado
-- anterior. A policy existente já resolve corretamente QUEM pode dar
-- update (somente o proprietário do tenant); falta travar O QUÊ pode ser
-- alterado nesse update. A forma idiomática em Postgres/Supabase para travar
-- coluna a coluna comparando `old` e `new` é um trigger `before
-- update`, que roda antes da linha ser escrita e pode `raise exception`
-- para abortar a transação quando uma coluna imutável muda. Mantemos a
-- policy como está (ela continua sendo a barreira de "quem") e adicionamos
-- este trigger como a barreira de "o quê", em complemento — nenhuma delas
-- substitui a outra.
--
-- Somente as colunas do fluxo de decisão de estado podem ser alteradas por
-- este caminho: `status`, `decided_at`, `decided_by`, `revoked_at` e
-- `revoked_by`. `tenant_id`, `client_user_id` e `requested_at` são
-- imutáveis após a criação do vínculo (a criação em si é responsabilidade
-- de uma função SECURITY DEFINER futura, fora desta tabela — ver comentário
-- no topo de 20260806100300_provider_client_links.sql).

create or replace function public.enforce_provider_client_links_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'LINK_IMMUTABLE_FIELD: tenant_id cannot be changed' using errcode = '22023';
  end if;

  if new.client_user_id is distinct from old.client_user_id then
    raise exception 'LINK_IMMUTABLE_FIELD: client_user_id cannot be changed' using errcode = '22023';
  end if;

  if new.requested_at is distinct from old.requested_at then
    raise exception 'LINK_IMMUTABLE_FIELD: requested_at cannot be changed' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists provider_client_links_immutable_columns on public.provider_client_links;
create trigger provider_client_links_immutable_columns
  before update on public.provider_client_links
  for each row
  execute function public.enforce_provider_client_links_immutable_columns();
