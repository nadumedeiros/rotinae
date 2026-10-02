-- Seed sintético local (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 10.3).
-- Sem PII real. Roda só em ambiente local/staging — nunca em produção.
--
-- PRÉ-REQUISITO: os 4 usuários abaixo precisam existir em auth.users antes
-- de rodar este seed. Criar via Dashboard (Authentication > Add user) ou
-- Admin API/CLI local (`supabase` gera usuários de teste com senha conhecida
-- em ambiente local automaticamente ao usar `supabase db reset` com um
-- arquivo de seed de Auth próprio — ver docs.supabase.com/guides/cli/seeding-your-database).
-- Não escrevemos diretamente em auth.users aqui: é schema interno do Supabase
-- Auth e criar linhas à mão nele não é suportado de forma estável entre versões.
--
-- Troque os UUIDs abaixo pelos IDs reais gerados para cada usuário de teste.

do $$
declare
  provider_a uuid := '00000000-0000-0000-0000-000000000001';
  provider_b uuid := '00000000-0000-0000-0000-000000000002';
  client_a   uuid := '00000000-0000-0000-0000-000000000003';
  client_b   uuid := '00000000-0000-0000-0000-000000000004';
  tenant_a   uuid;
  tenant_b   uuid;
  terms_doc  uuid;
  privacy_doc uuid;
begin
  -- Perfis
  insert into public.profiles (user_id, role, display_name, phone, status)
  values
    (provider_a, 'provider', 'Prestador Um (seed)', null, 'active'),
    (provider_b, 'provider', 'Prestador Dois (seed)', null, 'active'),
    (client_a, 'client', 'Cliente Um (seed)', null, 'active'),
    (client_b, 'client', 'Cliente Dois (seed)', null, 'active')
  on conflict (user_id) do nothing;

  -- Tenants isolados
  insert into public.tenants (owner_user_id, display_name, timezone, status)
  values (provider_a, 'Tenant do Prestador Um', 'America/Sao_Paulo', 'active')
  on conflict (owner_user_id) do nothing
  returning id into tenant_a;

  insert into public.tenants (owner_user_id, display_name, timezone, status)
  values (provider_b, 'Tenant do Prestador Dois', 'America/Sao_Paulo', 'active')
  on conflict (owner_user_id) do nothing
  returning id into tenant_b;

  if tenant_a is null then
    select id into tenant_a from public.tenants where owner_user_id = provider_a;
  end if;
  if tenant_b is null then
    select id into tenant_b from public.tenants where owner_user_id = provider_b;
  end if;

  -- Cliente A: vínculo Ativo no tenant A e Pendente no tenant B.
  insert into public.provider_client_links (tenant_id, client_user_id, status, decided_at, decided_by)
  values (tenant_a, client_a, 'active', now(), provider_a)
  on conflict do nothing;

  insert into public.provider_client_links (tenant_id, client_user_id, status)
  values (tenant_b, client_a, 'pending')
  on conflict do nothing;

  -- Cliente B: vínculo Rejeitado no tenant A e Revogado no tenant B, para
  -- testes negativos de acesso.
  insert into public.provider_client_links (tenant_id, client_user_id, status, decided_at, decided_by)
  values (tenant_a, client_b, 'rejected', now(), provider_a)
  on conflict do nothing;

  insert into public.provider_client_links (tenant_id, client_user_id, status, decided_at, decided_by, revoked_at, revoked_by)
  values (tenant_b, client_b, 'revoked', now(), provider_b, now(), provider_b)
  on conflict do nothing;

  -- Código de vínculo de teste, exclusivamente local ("TESTE-LOCAL-0001").
  --
  -- Correção (BACKLOG.md, DEC-069): este hash era calculado com um sha256
  -- simples, calculado ANTES de existir o esquema bcrypt+pepper das RPCs de
  -- vínculo (20260806101300_provider_link_rpcs.sql, DEC-066). Como
  -- `redeem_provider_link_code` valida com `public.verify_provider_link_code`
  -- (que usa `crypt()`/bcrypt, não sha256), o código de teste nunca era
  -- resgatável de fato — só existia como uma linha "active" no banco, sem
  -- utilidade para exercitar o fluxo real.
  --
  -- `public.hash_provider_link_code()` é `revoke all ... from public, anon,
  -- authenticated`, mas isso não afeta este seed: `supabase db reset`
  -- executa `seed.sql` como o papel de migração (superusuário/dono dos
  -- objetos), que sempre ignora checagens de privilégio de EXECUTE — a
  -- mesma razão pela qual os triggers SECURITY DEFINER deste projeto também
  -- não precisam de nenhuma concessão especial para rodar durante `db reset`.
  --
  -- `gen_salt('bf')` é não determinístico por linha (DEC-066): duas chamadas
  -- de `hash_provider_link_code('TESTE-LOCAL-0001')` produzem hashes
  -- diferentes, então `on conflict (token_hash) do nothing` (que funcionava
  -- com o sha256 antigo, sempre igual) deixaria de ser idempotente e
  -- colidiria com o índice único `provider_link_codes_one_active_per_tenant`
  -- se este arquivo for reexecutado num banco já semeado. Por isso a
  -- idempotência passa a ser checada explicitamente antes do insert.
  if not exists (
    select 1 from public.provider_link_codes
    where tenant_id = tenant_a and status = 'active'
  ) then
    insert into public.provider_link_codes (tenant_id, token_hash, display_prefix, status)
    values (tenant_a, public.hash_provider_link_code('TESTE-LOCAL-0001'), 'TEST-0001', 'active');
  end if;

  -- Versões ativas de Termos e Política.
  insert into public.legal_documents (kind, version, effective_at, status)
  values ('terms', 'seed-1.0.0', now(), 'active')
  on conflict (kind, version) do nothing
  returning id into terms_doc;

  insert into public.legal_documents (kind, version, effective_at, status)
  values ('privacy_policy', 'seed-1.0.0', now(), 'active')
  on conflict (kind, version) do nothing
  returning id into privacy_doc;

  if terms_doc is null then
    select id into terms_doc from public.legal_documents where kind = 'terms' and version = 'seed-1.0.0';
  end if;
  if privacy_doc is null then
    select id into privacy_doc from public.legal_documents where kind = 'privacy_policy' and version = 'seed-1.0.0';
  end if;

  insert into public.legal_acknowledgements (user_id, document_id, action, source)
  values
    (client_a, terms_doc, 'accepted_terms', 'web'),
    (client_a, privacy_doc, 'acknowledged_privacy', 'web');

  -- Preferência concedida e revogada por finalidade, para o cliente A.
  insert into public.communication_preferences (user_id, channel, purpose, granted)
  values
    (client_a, 'whatsapp', 'appointment_reminder', true),
    (client_a, 'email', 'product_updates', false)
  on conflict (user_id, channel, purpose) do nothing;

  insert into public.consent_events (user_id, channel, purpose, action, notice_version, source)
  values
    (client_a, 'whatsapp', 'appointment_reminder', 'granted', 'seed-1.0.0', 'web'),
    (client_a, 'email', 'product_updates', 'revoked', 'seed-1.0.0', 'web');

  -- Serviços padrão do catálogo
  insert into public.services (tenant_id, name, duration_minutes, reference_value_cents, status)
  values
    (tenant_a, 'Atendimento padrao', 60, 10000, 'active'),
    (tenant_a, 'Aula', 60, 12000, 'active'),
    (tenant_b, 'Atendimento padrao', 60, 10000, 'active'),
    (tenant_b, 'Aula', 60, 12000, 'active')
  on conflict do nothing;
end $$;
