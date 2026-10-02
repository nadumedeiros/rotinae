-- Etapa 1 — extensões e enums do modelo mínimo (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4).
-- Nenhuma tabela é criada aqui; cada tabela nasce com suas próprias constraints,
-- índices e RLS na migration correspondente (seção 10.2 do documento).

create extension if not exists pgcrypto; -- gen_random_uuid()

do $$ begin
  create type profile_role as enum ('provider', 'client');
exception when duplicate_object then null; end $$;

do $$ begin
  create type profile_status as enum ('active', 'blocked', 'deleted');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tenant_status as enum ('active', 'suspended', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type link_code_status as enum ('active', 'revoked', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type link_status as enum ('pending', 'active', 'rejected', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_document_kind as enum ('terms', 'privacy_policy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_document_status as enum ('draft', 'active', 'retired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type legal_ack_action as enum ('accepted_terms', 'acknowledged_privacy');
exception when duplicate_object then null; end $$;

do $$ begin
  create type consent_channel as enum ('email', 'push', 'whatsapp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type consent_action as enum ('granted', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app_platform as enum ('web', 'android', 'ios');
exception when duplicate_object then null; end $$;
