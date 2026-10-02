-- Etapa 1 — trigger de cadastro (docs/HANDOFF_CADASTRO_RECUPERACAO_CRIS.md,
-- seção 3.1; BACKLOG.md, DEC-068, desbloqueando BLG-044).
--
-- Contexto: com confirmação de e-mail obrigatória (DEC-055), `supabase.auth.signUp()`
-- não devolve sessão (`data.session = null`) até o e-mail ser confirmado. No
-- momento do cadastro não existe `auth.uid()`, então as policies
-- `profiles_insert_self`, `legal_acknowledgements_insert_self` e
-- `consent_events_insert_self` (que exigem `authenticated` + `auth.uid() = user_id`)
-- não podem ser satisfeitas client-side. Este trigger `SECURITY DEFINER` em
-- `auth.users` é o padrão consolidado do próprio Supabase para esse problema:
-- roda com o privilégio de quem o criou (bypassa RLS), lê `raw_user_meta_data`
-- (populado pelo `options.data` de `signUp`, ver `supabase-auth-registration-adapter.ts`)
-- e grava `profiles` + `legal_acknowledgements` (+ `consent_events` quando
-- aplicável) na mesma transação da criação da identidade em `auth.users`.
--
-- DECISÃO DE COMPORTAMENTO — falha explícita, nunca usuário "órfão" (DEC-068):
-- Como o trigger é `AFTER INSERT` e roda na mesma transação implícita do
-- INSERT em `auth.users`, qualquer `RAISE EXCEPTION` aqui reverte também a
-- criação da identidade no Auth: não existe estado intermediário em que o
-- usuário exista em `auth.users` sem perfil/aceites correspondentes. Isso é
-- deliberado: metadados ausentes/malformados (papel inválido, nome vazio,
-- `consentVersion` sem par `terms`+`privacy_policy` publicados com
-- `status = 'active'` para essa mesma versão — regra explícita da seção 3.1
-- do handoff e do comentário de `SignUpLegalAcceptance` em domain/auth/types.ts)
-- fazem o `signUp` inteiro falhar (GoTrue devolve erro 500 genérico ao
-- cliente); o adaptador mapeia isso para `UNKNOWN` (ver seção 5 do handoff:
-- nenhum destes casos tem código público próprio, porque são bugs de
-- integração/publicação de documento legal, não erro de usuário final).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role profile_role;
  v_name text;
  v_phone text;
  v_consent_version text;
  v_marketing text;
  v_source app_platform;
  v_terms_doc uuid;
  v_privacy_doc uuid;
begin
  v_name := new.raw_user_meta_data->>'name';
  v_phone := new.raw_user_meta_data->>'phone';
  v_consent_version := new.raw_user_meta_data->>'consentVersion';
  v_marketing := new.raw_user_meta_data->>'marketingConsent';
  -- `source` é obrigatório em SignUpLegalAcceptance, mas o trigger é
  -- defensivo (ex.: contas criadas fora do fluxo de signUp da tela, como
  -- pelo Dashboard/Admin API): sem ele, assume 'web' em vez de falhar.
  v_source := coalesce((new.raw_user_meta_data->>'source')::app_platform, 'web');

  -- `role` inválido/ausente faz o `::profile_role` abaixo lançar erro nativo
  -- de enum (nenhum RAISE explícito necessário); mantemos a checagem de nulo
  -- separada só para produzir uma mensagem de erro mais clara em log.
  if new.raw_user_meta_data->>'role' is null then
    raise exception 'SIGNUP_METADATA_MISSING: role is required' using errcode = '22023';
  end if;
  v_role := (new.raw_user_meta_data->>'role')::profile_role;

  if v_name is null or length(trim(v_name)) = 0 then
    raise exception 'SIGNUP_METADATA_MISSING: name is required' using errcode = '22023';
  end if;

  if v_consent_version is null or length(trim(v_consent_version)) = 0 then
    raise exception 'SIGNUP_METADATA_MISSING: consentVersion is required' using errcode = '22023';
  end if;

  -- `status` continua 'active' por padrão (default da coluna): o bloqueio de
  -- sessão operacional para e-mail não confirmado acontece via
  -- `email_confirmed_at` no GoTrue, não em `profiles.status` (seção 3.1 do
  -- handoff; `mapSupabaseAuthError` -> `AUTH_EMAIL_NOT_CONFIRMED`).
  insert into public.profiles (user_id, role, display_name, phone)
  values (new.id, v_role, trim(v_name), v_phone);

  -- As duas linhas de aceite exigem que 'terms' e 'privacy_policy' tenham,
  -- cada um, uma versão `active` com o MESMO valor de `consentVersion` (a
  -- tela apresenta um único checkbox combinado — regra 9 do handoff, seção 4).
  -- Ausência de qualquer um dos dois é tratada como falha de publicação do
  -- documento legal, não como erro do usuário: aborta toda a transação.
  select id into v_terms_doc
  from public.legal_documents
  where kind = 'terms' and version = v_consent_version and status = 'active';

  if v_terms_doc is null then
    raise exception 'LEGAL_DOCUMENT_NOT_FOUND: terms version % not active', v_consent_version
      using errcode = '22023';
  end if;

  select id into v_privacy_doc
  from public.legal_documents
  where kind = 'privacy_policy' and version = v_consent_version and status = 'active';

  if v_privacy_doc is null then
    raise exception 'LEGAL_DOCUMENT_NOT_FOUND: privacy_policy version % not active', v_consent_version
      using errcode = '22023';
  end if;

  insert into public.legal_acknowledgements (user_id, document_id, action, source)
  values
    (new.id, v_terms_doc, 'accepted_terms', v_source),
    (new.id, v_privacy_doc, 'acknowledged_privacy', v_source);

  -- Marketing é opcional e não gera evento quando ausente/'false': o estado
  -- inicial permanece `unset`, nunca `revoked` (regra 10 do handoff; seção
  -- 5.4 de ARQUITETURA_BACKEND_ETAPA_1.md). `->>'marketingConsent'` extrai o
  -- texto 'true'/'false' tanto se `options.data` enviar um boolean JSON
  -- quanto uma string — jsonb `->>` normaliza os dois casos.
  if v_marketing = 'true' then
    insert into public.consent_events (user_id, channel, purpose, action, notice_version, source)
    values (new.id, 'email', 'marketing', 'granted', v_consent_version, v_source);
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Nota sobre auditoria: `profiles`, `legal_acknowledgements` e `consent_events`
-- não têm trigger de `audit_creation`/`audit_status_change` (20260806101000/101100
-- cobrem só `tenants`/`provider_client_links`/`provider_link_codes`) — cadastro
-- de conta não é, hoje, um evento coberto por `audit_events`. Fora do escopo
-- desta migration ampliar essa cobertura sem uma decisão própria.
