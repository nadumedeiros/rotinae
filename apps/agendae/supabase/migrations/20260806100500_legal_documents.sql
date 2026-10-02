-- Etapa 1 — legal_documents (docs/ARQUITETURA_BACKEND_ETAPA_1.md, seção 4.5).
-- O texto legal pode viver fora da tabela; aqui só identificamos de forma
-- inequívoca a versão vigente. Validação jurídica do conteúdo continua
-- obrigatória e é responsabilidade de quem publica (fora do escopo do schema).

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind legal_document_kind not null,
  version text not null,
  published_at timestamptz not null default now(),
  effective_at timestamptz not null,
  status legal_document_status not null default 'draft',
  unique (kind, version)
);

create index if not exists legal_documents_kind_status_idx on public.legal_documents (kind, status);

alter table public.legal_documents enable row level security;

-- Documentos ativos são de leitura pública (precisam aparecer antes do login,
-- na tela de cadastro). Rascunho/retirado não são expostos.
create policy "legal_documents_select_active_public"
  on public.legal_documents for select
  to anon, authenticated
  using (status = 'active');

-- Sem policy de insert/update/delete para anon/authenticated: publicação de
-- versão é operação administrativa (service_role/painel), não do cliente.
