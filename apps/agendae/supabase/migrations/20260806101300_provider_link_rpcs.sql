-- Etapa 1 — funções SECURITY DEFINER que fecham o caminho de execução do
-- vínculo cliente<->prestador por código (docs/ARQUITETURA_BACKEND_ETAPA_1.md,
-- seções 4.3/4.4/8.1; docs/HANDOFF_CLIENTES_VINCULO_CRIS.md, seções 3/4/7;
-- BACKLOG.md, DEC-065/BLG-042/BLG-045).
--
-- Até esta migration, `provider_client_links` e `provider_link_codes`
-- tinham schema, RLS e triggers, mas nenhuma linha `pending`/`active` podia
-- nascer de forma segura: não havia policy de insert para `provider_client_links`
-- (de propósito) nem função que resolvesse um código informado pelo cliente.
-- As 4 funções abaixo são esse caminho de execução que faltava.
--
-- ============================================================================
-- DECISÃO DE DESIGN — hash do código de vínculo com pepper (ver DEC-066)
-- ============================================================================
--
-- `provider_link_codes.token_hash` passa a ser calculado com `crypt()` do
-- pgcrypto usando `gen_salt('bf')` (bcrypt): cada linha recebe um salt
-- aleatório embutido no próprio hash, então o resultado NUNCA é determinístico
-- simples (dois códigos idênticos gerados em momentos diferentes produzem
-- hashes diferentes) — isso satisfaz por si só o requisito de "hash forte com
-- salt por linha" independentemente de qualquer segredo adicional.
--
-- Por cima do bcrypt, o código completo é concatenado com um "pepper" lido de
-- uma GUC de banco (`app.settings.link_code_pepper`) antes do hash, via
-- `public.link_code_pepper()`. Essa GUC é distinta da variável de ambiente
-- `LINK_CODE_PEPPER` já catalogada em ARQUITETURA_BACKEND_ETAPA_1.md (seção
-- 9.2) para uso em servidor/CI: aqui ela precisa existir dentro do próprio
-- Postgres, porque o hash é calculado em SQL/PL-pgSQL, não em uma Edge
-- Function. Nenhum valor de pepper é definido nesta migration (isso vazaria o
-- segredo para o Git); a função só faz `current_setting(..., true)` e usa
-- string vazia quando a GUC não existir.
--
-- LIMITAÇÃO CONHECIDA (registrar acompanhamento em BLG-042/DEC-066): este
-- projeto ainda não tem Supabase Vault nem outro cofre de segredos acessível
-- a partir de SQL. Enquanto `app.settings.link_code_pepper` não for
-- configurada por operação (`alter database postgres set
-- app.settings.link_code_pepper = '<valor-do-cofre>';`, executado fora do
-- controle de versão, por ambiente), o pepper efetivo é vazio e a segurança
-- do hash depende inteiramente do bcrypt + da entropia de 128 bits do
-- próprio código — o que já é seguro na prática, mas perde a camada extra de
-- defesa em profundidade prevista na arquitetura. Não é uma falha ativa: é a
-- ausência documentada de uma camada opcional, e este comentário é a
-- evidência exigida pelo processo do BACKLOG.md antes de ir para produção.
--
-- Por que bcrypt (não determinístico) em vez de HMAC/digest determinístico
-- com pepper: um hash determinístico permitiria localizar a linha por
-- igualdade de índice (`token_hash = ...`), o que é mais rápido, mas o
-- código já tem 128 bits de entropia — o ganho de desempenho não compensa
-- abrir mão do salt por linha pedido explicitamente para este achado. Como
-- contrapartida, `redeem_provider_link_code` não pode fazer busca indexada:
-- ela varre os códigos `active`/não expirados e testa `crypt()` linha a
-- linha. Em produção, o número de linhas nesse estado é no máximo um por
-- tenant (índice único parcial já existente), então o custo cresce com o
-- número de prestadores, não com o de tentativas — aceitável para o volume
-- do MVP. Se isso deixar de ser verdade, revisar esta decisão.

-- ============================================================================
-- Helpers de hashing (não expostos a anon/authenticated diretamente)
-- ============================================================================

create or replace function public.link_code_pepper()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('app.settings.link_code_pepper', true), '');
$$;

revoke all on function public.link_code_pepper() from public, anon, authenticated;

-- Gera o hash de um código completo. Não é STABLE/IMMUTABLE: gen_salt('bf')
-- é intencionalmente aleatório a cada chamada.
create or replace function public.hash_provider_link_code(code text)
returns text
language sql
set search_path = public, pg_temp
as $$
  select extensions.crypt(
    public.link_code_pepper() || code,
    extensions.gen_salt('bf', 10)
  );
$$;

revoke all on function public.hash_provider_link_code(text) from public, anon, authenticated;

-- Verifica um código informado contra um hash já persistido.
create or replace function public.verify_provider_link_code(code text, hash text)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select hash = extensions.crypt(public.link_code_pepper() || code, hash);
$$;

revoke all on function public.verify_provider_link_code(text, text) from public, anon, authenticated;

-- ============================================================================
-- 1) Rotação/geração de código — só o Prestador proprietário do tenant
-- ============================================================================

create or replace function public.rotate_provider_link_code()
returns table (
  id uuid,
  display_prefix text,
  status link_code_status,
  expires_at timestamptz,
  created_at timestamptz,
  full_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_full_code text;
  v_hash text;
  v_prefix text;
  v_new_id uuid;
  v_created_at timestamptz;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where user_id = v_caller and role = 'provider'
  ) then
    raise exception 'FORBIDDEN: caller must be a provider' using errcode = '42501';
  end if;

  select t.id into v_tenant_id
  from public.tenants t
  where t.owner_user_id = v_caller;

  if v_tenant_id is null then
    raise exception 'FORBIDDEN: caller does not own a tenant' using errcode = '42501';
  end if;

  -- CSPRNG >= 128 bits (seção 4.3): 16 bytes = 128 bits, codificados em hex.
  v_full_code := encode(gen_random_bytes(16), 'hex');
  v_hash := public.hash_provider_link_code(v_full_code);
  -- Prefixo não sensível: 8 dos 32 caracteres hex ainda deixam 96 bits de
  -- entropia não revelados, seguro para exibição/auditoria (seção 4.3).
  v_prefix := left(v_full_code, 8);

  -- Revoga atomicamente o código ativo anterior do tenant antes de inserir o
  -- novo (seção 5.3: "rotação revoga o código atual e cria outro
  -- atomicamente"). Ambos os comandos correm na mesma transação implícita da
  -- função, então o índice único parcial `..._one_active_per_tenant` nunca vê
  -- dois códigos `active` do mesmo tenant ao mesmo tempo.
  update public.provider_link_codes
  set status = 'revoked', revoked_at = now()
  where tenant_id = v_tenant_id
    and status = 'active';

  insert into public.provider_link_codes (tenant_id, token_hash, display_prefix, status)
  values (v_tenant_id, v_hash, v_prefix, 'active')
  returning provider_link_codes.id, provider_link_codes.created_at
  into v_new_id, v_created_at;

  -- `full_code` só existe neste retorno; nunca é persistido em texto puro
  -- (seção 4.3) e não deve ser logado pelo chamador.
  return query
  select v_new_id, v_prefix, 'active'::link_code_status, null::timestamptz, v_created_at, v_full_code;
end;
$$;

revoke all on function public.rotate_provider_link_code() from public, anon, authenticated;
grant execute on function public.rotate_provider_link_code() to authenticated;

-- ============================================================================
-- 2) Resgate de código pelo cliente — cria a solicitação `pending`
-- ============================================================================

create or replace function public.redeem_provider_link_code(code text)
returns table (
  id uuid,
  tenant_id uuid,
  status link_status,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_existing_status link_status;
  v_link_id uuid;
  v_requested_at timestamptz;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  -- RN-PER-016 / seção 2 do handoff: só uma conta com perfil `client` pode
  -- resgatar código. Falha antes de qualquer checagem de tenant/código, e
  -- não revela nada além do descasamento de perfil.
  if not exists (
    select 1 from public.profiles
    where user_id = v_caller and role = 'client'
  ) then
    raise exception 'LINK_ROLE_MISMATCH: caller must be a client' using errcode = '22023';
  end if;

  if code is null or length(trim(code)) = 0 then
    raise exception 'LINK_CODE_NOT_FOUND: invalid or expired code' using errcode = '22023';
  end if;

  -- Sem índice/lookup direto por hash: bcrypt tem salt por linha (ver bloco
  -- de decisão no topo do arquivo), então a única forma correta de resolver
  -- é testar candidatos ativos e não expirados. Isso é o comportamento
  -- pretendido para anti-enumeração — o custo não depende de o código
  -- existir ou não.
  select plc.tenant_id into v_tenant_id
  from public.provider_link_codes plc
  where plc.status = 'active'
    and (plc.expires_at is null or plc.expires_at > now())
    and public.verify_provider_link_code(code, plc.token_hash)
  limit 1;

  -- Resposta genérica única: não existe um segundo ramo que diga "existia
  -- mas expirou". O adaptador Supabase é livre para sempre mapear este sinal
  -- para LINK_CODE_NOT_FOUND; LINK_CODE_EXPIRED, no contrato do front, fica
  -- reservado para o prestador consultar o status do PRÓPRIO código (onde
  -- não enumerar não é uma preocupação).
  if v_tenant_id is null then
    raise exception 'LINK_CODE_NOT_FOUND: invalid or expired code' using errcode = '22023';
  end if;

  select l.status into v_existing_status
  from public.provider_client_links l
  where l.tenant_id = v_tenant_id
    and l.client_user_id = v_caller
    and l.status in ('pending', 'active')
  limit 1;

  if v_existing_status is not null then
    raise exception 'LINK_ALREADY_EXISTS: link already requested or active' using errcode = '22023';
  end if;

  begin
    insert into public.provider_client_links (tenant_id, client_user_id, status)
    values (v_tenant_id, v_caller, 'pending')
    returning provider_client_links.id, provider_client_links.requested_at
    into v_link_id, v_requested_at;
  exception when unique_violation then
    -- Backstop de corrida concorrente: o índice único parcial
    -- `provider_client_links_one_active_per_pair` garante que, mesmo com dois
    -- resgates simultâneos, só um insert vinga.
    raise exception 'LINK_ALREADY_EXISTS: link already requested or active' using errcode = '22023';
  end;

  -- Não concede nenhum acesso operacional: a linha nasce sempre `pending`.
  return query
  select v_link_id, v_tenant_id, 'pending'::link_status, v_requested_at;
end;
$$;

revoke all on function public.redeem_provider_link_code(text) from public, anon, authenticated;
grant execute on function public.redeem_provider_link_code(text) to authenticated;

-- ============================================================================
-- 3) Decisão do vínculo — só o Prestador proprietário do tenant do vínculo
-- ============================================================================

create or replace function public.decide_provider_link_request(link_id uuid, decision text)
returns table (
  id uuid,
  status link_status,
  decided_at timestamptz,
  decided_by uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_target_status link_status;
  v_locked_id uuid;
  v_new_status link_status;
  v_decided_at timestamptz;
  v_decided_by uuid;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  if decision = 'approve' then
    v_target_status := 'active';
  elsif decision = 'reject' then
    v_target_status := 'rejected';
  else
    raise exception 'INVALID_LINK_TRANSITION: decision must be approve or reject' using errcode = '22023';
  end if;

  -- Trava a linha (se existir, pertencer ao tenant do chamador e estiver
  -- pending) antes de decidir, para serializar decisões concorrentes sobre o
  -- mesmo vínculo. Não existência, tenant errado e status diferente de
  -- pending produzem exatamente o mesmo sinal de "não encontrado" — o
  -- chamador nunca sabe se o vínculo pertence a outro tenant.
  select l.id into v_locked_id
  from public.provider_client_links l
  join public.tenants t on t.id = l.tenant_id
  where l.id = link_id
    and t.owner_user_id = v_caller
    and l.status = 'pending'
  for update of l;

  if v_locked_id is null then
    raise exception 'LINK_REQUEST_NOT_FOUND: request not found or already decided' using errcode = '22023';
  end if;

  update public.provider_client_links
  set status = v_target_status,
      decided_at = now(),
      decided_by = v_caller
  where public.provider_client_links.id = v_locked_id
  returning status, decided_at, decided_by
  into v_new_status, v_decided_at, v_decided_by;

  return query
  select v_locked_id, v_new_status, v_decided_at, v_decided_by;
end;
$$;

revoke all on function public.decide_provider_link_request(uuid, text) from public, anon, authenticated;
grant execute on function public.decide_provider_link_request(uuid, text) to authenticated;

-- ============================================================================
-- 4) Revogação do vínculo — só o Prestador proprietário; active -> revoked
-- ============================================================================

create or replace function public.revoke_provider_client_link(link_id uuid)
returns table (
  id uuid,
  status link_status,
  revoked_at timestamptz,
  revoked_by uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_locked_id uuid;
  v_new_status link_status;
  v_revoked_at timestamptz;
  v_revoked_by uuid;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select l.id into v_locked_id
  from public.provider_client_links l
  join public.tenants t on t.id = l.tenant_id
  where l.id = link_id
    and t.owner_user_id = v_caller
    and l.status = 'active'
  for update of l;

  if v_locked_id is null then
    raise exception 'LINK_REQUEST_NOT_FOUND: link not found or not active' using errcode = '22023';
  end if;

  update public.provider_client_links
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = v_caller
  where public.provider_client_links.id = v_locked_id
  returning status, revoked_at, revoked_by
  into v_new_status, v_revoked_at, v_revoked_by;

  return query
  select v_locked_id, v_new_status, v_revoked_at, v_revoked_by;
end;
$$;

revoke all on function public.revoke_provider_client_link(uuid) from public, anon, authenticated;
grant execute on function public.revoke_provider_client_link(uuid) to authenticated;

-- ============================================================================
-- Nota sobre auditoria (seção 4.8 / princípio 7)
-- ============================================================================
--
-- As 4 funções não inserem em `audit_events` diretamente: os triggers já
-- existentes `provider_client_links_audit_creation`,
-- `provider_client_links_audit_status_change`,
-- `provider_link_codes_audit_creation` e `provider_link_codes_audit_status_change`
-- (20260806101000/101100) disparam automaticamente sobre os INSERTs e
-- UPDATEs de `status` feitos por estas funções, porque os triggers reagem à
-- tabela, não a quem chamou o INSERT/UPDATE. Duplicar a escrita aqui geraria
-- dois eventos para a mesma ação. Nenhum código completo, hash ou dado de
-- outro tenant é passado a essas funções de auditoria: elas só leem
-- `id`/`tenant_id`/`status` da própria linha.
