-- Corrige incidente de produção reportado em 12/08/2026, após o build 1.0.4:
-- código de vínculo recém-gerado pelo Prestador (`rotate_provider_link_code`)
-- é rejeitado pelo Cliente como `LINK_CODE_NOT_FOUND` ("Código inválido ou
-- expirado.") mesmo copiado/colado imediatamente.
--
-- ============================================================================
-- CAUSA RAIZ CONFIRMADA — descasamento de maiúsculas/minúsculas
-- ============================================================================
--
-- `rotate_provider_link_code()` (20260806101300_provider_link_rpcs.sql, linha
-- ~145) gera o código completo com:
--
--   v_full_code := encode(gen_random_bytes(16), 'hex');
--
-- `encode(..., 'hex')` do Postgres SEMPRE devolve dígitos hexadecimais em
-- minúsculo (`0-9a-f`). Esse `v_full_code` é hasheado com bcrypt
-- (`hash_provider_link_code`) e o valor em texto puro só existe no retorno da
-- própria chamada de rotação — nunca é persistido (seção 4.3).
--
-- A tela do Cliente que resgata esse código
-- (`apps/agendae/app/client-providers.tsx`) força maiúsculas em dois pontos:
-- o `onChangeText` do campo (`setCode(value.toUpperCase())`) e, de novo, em
-- `sendRequest()` (`code.trim().toUpperCase()`) antes de chamar
-- `clientPortfolioService.redeemProviderLinkCode(normalizedCode)`, que repassa
-- o valor tal como recebido para a RPC (nenhuma normalização adicional em
-- `supabase-client-portfolio-adapter.ts`, só `.trim()`).
--
-- `redeem_provider_link_code(code text)` compara o candidato contra o hash
-- via `verify_provider_link_code`, que por sua vez usa
-- `extensions.crypt(pepper || code, hash)` — uma comparação de bytes exata
-- (bcrypt/crypt não são case-insensitive). Qualquer código com pelo menos um
-- caractere `a-f` (praticamente garantido: um hex de 32 dígitos aleatórios
-- tem probabilidade desprezível de conter só dígitos `0-9`) deixa de bater
-- assim que a tela do Cliente o transforma para maiúsculas antes de enviar —
-- por isso a redenção falha de forma sistemática, não intermitente, e o
-- sintoma aparece em QUALQUER código, "recém-gerado" ou não.
--
-- Trecho problemático (redeem, tal como instalado por 20260806101300, nunca
-- alterado pelos dois patches seguintes):
--
--   select plc.tenant_id into v_tenant_id
--   from public.provider_link_codes plc
--   where plc.status = 'active'
--     and (plc.expires_at is null or plc.expires_at > now())
--     and public.verify_provider_link_code(code, plc.token_hash)
--   limit 1;
--
-- `code` chega em maiúsculas do front; `plc.token_hash` foi calculado a
-- partir do `v_full_code` em minúsculas. Nenhuma normalização de case ocorre
-- em nenhum dos dois lados antes da comparação.
--
-- ============================================================================
-- CORREÇÃO — normalizar o candidato no próprio backend (defesa em profundidade)
-- ============================================================================
--
-- Em vez de depender de o front nunca alterar o case do código (frágil: basta
-- uma tela futura ou um autofill do teclado mudar isso de novo), a RPC passa
-- a normalizar o candidato para minúsculas antes de comparar. Isso é seguro
-- porque o alfabeto do código é estritamente hexadecimal (`0-9a-f`/`A-F`):
-- normalizar não reduz a entropia (continuam sendo os mesmos 128 bits, só
-- represantados de forma canônica) nem introduz colisões (mapeamento
-- injetivo de maiúsculas para minúsculas em um alfabeto hex). O
-- `display_prefix` de auditoria continua sendo gravado como o backend sempre
-- gerou (minúsculo) — não há mudança de schema nem de dado persistido, só do
-- valor comparado em tempo de leitura.
--
-- Não há necessidade de tocar `rotate_provider_link_code` (já gera em
-- minúsculas, formato canônico) nem a tela do Cliente: o backend passa a ser
-- tolerante ao case independentemente do que qualquer front fizer, hoje ou no
-- futuro.

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
  v_normalized_code text;
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

  -- Normalização de case (ver bloco de decisão no topo do arquivo desta
  -- migration): o código é sempre gerado em hex minúsculo por
  -- `rotate_provider_link_code`; qualquer variação de maiúsculas/minúsculas
  -- introduzida por telas atuais ou futuras deixa de quebrar a comparação.
  v_normalized_code := lower(trim(code));

  -- Sem índice/lookup direto por hash: bcrypt tem salt por linha (ver bloco
  -- de decisão no topo do arquivo original desta função), então a única
  -- forma correta de resolver é testar candidatos ativos e não expirados.
  -- Isso é o comportamento pretendido para anti-enumeração — o custo não
  -- depende de o código existir ou não.
  select plc.tenant_id into v_tenant_id
  from public.provider_link_codes plc
  where plc.status = 'active'
    and (plc.expires_at is null or plc.expires_at > now())
    and public.verify_provider_link_code(v_normalized_code, plc.token_hash)
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
