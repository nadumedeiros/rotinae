-- Etapa 1 — reconciliação clients <-> provider_client_links
-- (docs/HANDOFF_CLIENTES_VINCULO_CRIS.md, seção "Reconciliação entre cadastro
-- interno e conta do cliente"; BACKLOG.md, BLG-045, DEC-069).
--
-- Depende de 20260806101500_clients_registry.sql (tabela clients) e
-- 20260806101300_provider_link_rpcs.sql (decide_provider_link_request original).
--
-- ============================================================================
-- DECISÃO DE DESIGN — estender decide_provider_link_request em vez de criar
-- decide_provider_link_request_with_client
-- ============================================================================
--
-- O contrato do front (`DecideLinkInput` em domain/clients/types.ts) é um
-- único formato — `{ requestId, decision, targetClientId? }` — consumido por
-- um único método de porta (`decideLinkRequest`). Duas RPCs obrigariam o
-- adaptador a decidir qual chamar (ou sempre chamar a "with_client" passando
-- null, o que a esta altura só duplicaria a assinatura sem ganho). Estender a
-- função existente com um terceiro parâmetro opcional (`target_client_id uuid
-- default null`) mantém uma única função para uma única operação de domínio,
-- replicando exatamente a forma do contrato.
--
-- Como Postgres não permite `create or replace function` mudar a lista de
-- parâmetros (isso cria uma segunda função sobrecarregada, não substitui a
-- existente, e as duas coexistindo tornariam uma chamada com 2 argumentos
-- ambígua), a função de 2 argumentos é removida explicitamente antes de
-- recriar a de 3 argumentos.

drop function if exists public.decide_provider_link_request(uuid, text);

-- ============================================================================
-- Helpers de mascaramento — nunca devolvem o dado completo (seção
-- "Reconciliação": "devolve o mesmo shape... com maskedEmail/maskedPhone").
-- ============================================================================

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_email is null then null
    else
      left(split_part(p_email, '@', 1), 1)
      || repeat('*', greatest(length(split_part(p_email, '@', 1)) - 1, 1))
      || '@' || split_part(p_email, '@', 2)
  end;
$$;

create or replace function public.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_phone is null then null
    when length(p_phone) <= 4 then repeat('*', length(p_phone))
    else repeat('*', length(p_phone) - 4) || right(p_phone, 4)
  end;
$$;

-- ============================================================================
-- 1) preview_link_reconciliation — mesma classificação de
--    classifyClientReconciliation (domain/clients/link-reconciliation.ts),
--    mas transacional e com acesso real ao banco (comentário de referência
--    no próprio arquivo TS).
-- ============================================================================
--
-- Retorna jsonb — não `returns table` — porque o resultado combina uma lista
-- (candidates) com um campo de decisão único (recommendedAction) que não é
-- por-linha; usar tabela obrigaria um valor sentinela para o caso sem
-- candidato nenhum (create_new), o que é mais frágil do que expressar a
-- estrutura real do contrato (`LinkReconciliationPreview`) diretamente.
--
-- Regra 1 da seção "Reconciliação": e-mail só participa da correspondência
-- automática quando VERIFICADO (`auth.users.email_confirmed_at is not null`).
-- Sem verificação, cai direto para a tentativa por telefone (nunca
-- attach_existing por e-mail não confirmado).

create or replace function public.preview_link_reconciliation(link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_client_user_id uuid;
  v_identity_email text;
  v_identity_email_confirmed boolean;
  v_identity_phone text;
  v_normalized_email text;
  v_candidates jsonb;
  v_email_match_count integer;
  v_action text;
begin
  if v_caller is null then
    raise exception 'FORBIDDEN: authentication required' using errcode = '42501';
  end if;

  select l.tenant_id, l.client_user_id
    into v_tenant_id, v_client_user_id
  from public.provider_client_links l
  join public.tenants t on t.id = l.tenant_id
  where l.id = link_id
    and t.owner_user_id = v_caller
  limit 1;

  -- Vínculo inexistente ou de outro tenant: mesmo sinal (seção 4 do handoff:
  -- "tentativa cross-tenant retorna erro público neutro").
  if v_tenant_id is null then
    raise exception 'LINK_REQUEST_NOT_FOUND: request not found' using errcode = '22023';
  end if;

  select u.email, (u.email_confirmed_at is not null)
    into v_identity_email, v_identity_email_confirmed
  from auth.users u
  where u.id = v_client_user_id;

  select p.phone into v_identity_phone
  from public.profiles p
  where p.user_id = v_client_user_id;

  v_normalized_email := lower(btrim(coalesce(v_identity_email, '')));

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'clientId', c.id,
      'clientName', c.name,
      'maskedEmail', public.mask_email(c.email),
      'maskedPhone', public.mask_phone(c.phone),
      'matchReason', 'verified_email',
      'alreadyAttached', (c.client_user_id is not null)
    )), '[]'::jsonb),
    count(*)
  into v_candidates, v_email_match_count
  from public.clients c
  where c.tenant_id = v_tenant_id
    and c.status = 'active'
    and v_identity_email_confirmed
    and c.normalized_email = v_normalized_email;

  if v_email_match_count > 1 then
    -- Regra 5: mais de um cadastro com o mesmo e-mail exige revisão/mesclagem.
    v_action := 'manual_review';
  elsif v_email_match_count = 1 then
    -- Regra 3 (sem identidade -> attach_existing) vs. regra 6 (já associado a
    -- outra identidade -> conflito, nunca sobrescrito).
    v_action := case
      when (v_candidates -> 0 ->> 'alreadyAttached')::boolean then 'reject_conflict'
      else 'attach_existing'
    end;
  else
    -- Regra 4: correspondência só por telefone SEMPRE exige manual_review;
    -- nome nunca autoriza associação (não há busca por nome nesta função).
    if v_identity_phone is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'clientId', c.id,
        'clientName', c.name,
        'maskedEmail', public.mask_email(c.email),
        'maskedPhone', public.mask_phone(c.phone),
        'matchReason', 'phone_review',
        'alreadyAttached', (c.client_user_id is not null)
      )), '[]'::jsonb)
      into v_candidates
      from public.clients c
      where c.tenant_id = v_tenant_id
        and c.status = 'active'
        and c.phone = v_identity_phone;

      v_action := case when jsonb_array_length(v_candidates) > 0 then 'manual_review' else 'create_new' end;
    else
      v_candidates := '[]'::jsonb;
      v_action := 'create_new';
    end if;
  end if;

  return jsonb_build_object('candidates', v_candidates, 'recommendedAction', v_action);
end;
$$;

revoke all on function public.preview_link_reconciliation(uuid) from public, anon, authenticated;
grant execute on function public.preview_link_reconciliation(uuid) to authenticated;

-- ============================================================================
-- 2) decide_provider_link_request — agora também reconcilia `clients` na
--    aprovação (regras 3/6/7/8 da seção "Reconciliação"). Rejeição nunca
--    toca em `clients`.
-- ============================================================================

create or replace function public.decide_provider_link_request(
  link_id uuid,
  decision text,
  target_client_id uuid default null
)
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
  v_tenant_id uuid;
  v_client_user_id uuid;
  v_new_status link_status;
  v_decided_at timestamptz;
  v_decided_by uuid;
  v_existing_client_user uuid;
  v_target_tenant uuid;
  v_identity_email text;
  v_identity_name text;
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

  -- Mesma trava e mesmo sinal "não encontrado" unificado da versão original
  -- (20260806101300): inexistência, tenant errado e status != pending nunca
  -- se diferenciam para o chamador.
  select l.id, l.tenant_id, l.client_user_id
    into v_locked_id, v_tenant_id, v_client_user_id
  from public.provider_client_links l
  join public.tenants t on t.id = l.tenant_id
  where l.id = link_id
    and t.owner_user_id = v_caller
    and l.status = 'pending'
  for update of l;

  if v_locked_id is null then
    raise exception 'LINK_REQUEST_NOT_FOUND: request not found or already decided' using errcode = '22023';
  end if;

  if v_target_status = 'active' then
    if target_client_id is not null then
      -- Aprovação com reconciliação explícita (prestador escolheu um
      -- candidato no preview). Trava a linha candidata para serializar
      -- aprovações concorrentes que apontem para o mesmo cadastro.
      select c.client_user_id, c.tenant_id
        into v_existing_client_user, v_target_tenant
      from public.clients c
      where c.id = target_client_id
      for update of c;

      if v_target_tenant is null or v_target_tenant is distinct from v_tenant_id then
        -- Cadastro inexistente ou de outro tenant: mesmo sinal (nunca revela
        -- cadastro de outro prestador).
        raise exception 'CLIENT_NOT_FOUND: target client not found' using errcode = '22023';
      end if;

      if v_existing_client_user is not null and v_existing_client_user is distinct from v_client_user_id then
        -- Regra 6: cadastro já associado a OUTRA identidade nunca é
        -- sobrescrito.
        raise exception 'CLIENT_IDENTITY_ALREADY_ATTACHED: client already linked to another identity' using errcode = '22023';
      end if;

      -- Idempotente quando v_existing_client_user já é o mesmo client_user_id
      -- (retry de uma aprovação concorrente que já tinha vinculado).
      update public.clients
      set client_user_id = v_client_user_id,
          record_origin = 'reconciled'
      where id = target_client_id;
    else
      -- Regra 7: sem candidato informado, a aprovação cria o cadastro
      -- vinculado. Nome/e-mail vêm da identidade aprovada (auth.users/profiles),
      -- lidos aqui porque a função roda SECURITY DEFINER (mesmo padrão de
      -- preview_link_reconciliation).
      select u.email into v_identity_email from auth.users u where u.id = v_client_user_id;
      select p.display_name into v_identity_name from public.profiles p where p.user_id = v_client_user_id;

      begin
        insert into public.clients (
          tenant_id, client_user_id, record_origin, name, email, status, service_value_cents
        ) values (
          v_tenant_id, v_client_user_id, 'client_created',
          coalesce(v_identity_name, 'Cliente'), v_identity_email, 'active', 0
        );
      exception when unique_violation then
        -- Corrida concorrente ou prestador ignorou um preview que já
        -- apontava correspondência: índice único parcial
        -- clients_tenant_normalized_email_active_uk pega o conflito.
        raise exception 'CLIENT_EMAIL_CONFLICT: a client with this email already exists' using errcode = '22023';
      end;
    end if;
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

revoke all on function public.decide_provider_link_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.decide_provider_link_request(uuid, text, uuid) to authenticated;

-- ============================================================================
-- 3) view provider_pending_link_requests — expõe nome/e-mail do cliente para
--    listPendingLinkRequests SEM dar acesso direto a auth.users ao papel
--    authenticated (PostgREST nunca expõe o schema auth; este é o padrão
--    documentado pelo próprio Supabase para "ver e-mail de auth.users a
--    partir do schema public").
-- ============================================================================
--
-- Este objeto é uma VIEW, não uma tabela com RLS: por padrão, uma view roda
-- com o privilégio do seu OWNER (o papel de migração, superusuário) para
-- acessar as tabelas subjacentes — o que bypassaria RLS de
-- provider_client_links se a view não filtrasse por si só. Por isso o
-- isolamento por tenant é embutido diretamente no corpo da view
-- (`t.owner_user_id = auth.uid()`), não delegado a policies: `auth.uid()` é
-- resolvido a cada consulta a partir do JWT da sessão, então o filtro
-- continua correto por chamador mesmo com a view executando como owner.
-- Nenhum dado de outro tenant é exposto por este objeto.

drop view if exists public.provider_pending_link_requests;

create view public.provider_pending_link_requests as
select
  l.id,
  l.tenant_id,
  l.client_user_id,
  p.display_name as client_name,
  u.email as client_email,
  l.requested_at
from public.provider_client_links l
join public.tenants t on t.id = l.tenant_id
join public.profiles p on p.user_id = l.client_user_id
join auth.users u on u.id = l.client_user_id
where l.status = 'pending'
  and t.owner_user_id = auth.uid();

revoke all on public.provider_pending_link_requests from public, anon;
grant select on public.provider_pending_link_requests to authenticated;
