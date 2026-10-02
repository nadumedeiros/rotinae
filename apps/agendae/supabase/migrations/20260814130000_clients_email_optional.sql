-- ============================================================================
-- Clientes: E-mail Opcional
-- ============================================================================
-- Permite o cadastro de clientes pelo prestador sem exigência de e-mail.

alter table public.clients
  alter column email drop not null;

alter table public.clients
  drop constraint if exists clients_email_check;

alter table public.clients
  add constraint clients_email_check check (
    email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );
