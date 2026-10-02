-- ============================================================================
-- Correção: concessão manual de Premium (admin_set_provider_plan) não
-- refletia no horizonte de agendamento por plano (RN-PLN-018/019/020,
-- 20260819100000_provider_plan_horizon_limit.sql).
-- ============================================================================
--
-- CAUSA RAIZ:
-- `admin_set_provider_plan` (20260814120000) sempre setou apenas `status`
-- em `provider_subscriptions`, nunca `current_period_ends_at`/`trial_ends_at`.
-- Isso era inofensivo até 20260819100000 introduzir
-- `provider_has_unrestricted_appointment_horizon`, que exige status ativo/
-- trialing **e** uma data futura não-nula em
-- `coalesce(current_period_ends_at, trial_ends_at)`. Qualquer prestador com
-- Premium concedido manualmente pelo painel admin (sem passar pelo Mercado
-- Pago) ficou, a partir daquela migration, tratado como Plano Gratuito nessa
-- checagem específica — mesmo constando `status = 'active'` no painel.
--
-- CORREÇÃO:
-- 1) `admin_set_provider_plan` passa a gravar uma data-sentinela
--    (`9999-12-31`) em `current_period_ends_at` ao conceder `premium` —
--    concessão manual não tem ciclo de cobrança, então não expira sozinha;
--    só é revertida por outra chamada explícita a esta função com
--    `target_plan = 'free'`, que agora limpa `current_period_ends_at`.
-- 2) Backfill: corrige com a mesma data-sentinela qualquer registro já
--    preso nesse estado (status ativo/trialing, mas sem nenhuma data —
--    condição que só ocorre em concessão manual, nunca em assinatura real
--    do Mercado Pago, que sempre popula uma das duas datas).
-- ============================================================================

create or replace function public.admin_set_provider_plan(
  target_user_id uuid,
  target_plan text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  is_caller_admin boolean;
  new_status text;
  new_period_ends_at timestamptz;
  v_display_name text;
  v_email text;
begin
  -- 1. Validação de administrador
  select coalesce(is_admin, false) into is_caller_admin
  from public.profiles
  where user_id = auth.uid();

  if not is_caller_admin then
    raise exception 'ADMIN_FORBIDDEN: caller is not an administrator' using errcode = '42501';
  end if;

  -- 2. Validação do plano solicitado
  if target_plan not in ('free', 'premium') then
    raise exception 'INVALID_PLAN: plan must be free or premium' using errcode = '22023';
  end if;

  new_status := case when target_plan = 'premium' then 'active' else 'free' end;
  -- Concessão manual não tem data de ciclo real: usamos uma data-sentinela
  -- bem distante para satisfazer `provider_has_unrestricted_appointment_horizon`
  -- (RN-PLN-018/019/020) sem fingir um período pago. `free` limpa a data.
  new_period_ends_at := case when target_plan = 'premium' then timestamptz '9999-12-31 23:59:59+00' else null end;

  -- 3. Assegura que a linha em public.profiles e profile_roles existe para o prestador
  select email, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
  into v_email, v_display_name
  from auth.users
  where id = target_user_id;

  insert into public.profiles (
    user_id,
    display_name,
    role,
    is_admin
  ) values (
    target_user_id,
    coalesce(v_display_name, 'Prestador'),
    'provider',
    false
  )
  on conflict (user_id) do nothing;

  insert into public.profile_roles (
    user_id,
    role
  ) values (
    target_user_id,
    'provider'
  )
  on conflict (user_id, role) do nothing;

  -- 4. Upsert na tabela provider_subscriptions
  insert into public.provider_subscriptions (
    provider_user_id,
    status,
    current_period_ends_at,
    updated_at
  ) values (
    target_user_id,
    new_status,
    new_period_ends_at,
    now()
  )
  on conflict (provider_user_id)
  do update set
    status = excluded.status,
    current_period_ends_at = excluded.current_period_ends_at,
    updated_at = now();
end;
$$;

-- Backfill: mesma condição de bug, aplicada aos registros já existentes.
-- Restrita a status ativo/trialing SEM nenhuma data (isso nunca acontece em
-- assinatura real do Mercado Pago) e sem `mercado_pago_subscription_id`
-- (confirma que a linha nunca passou pelo checkout real).
update public.provider_subscriptions
set current_period_ends_at = timestamptz '9999-12-31 23:59:59+00',
    updated_at = now()
where status in ('active', 'trialing')
  and mercado_pago_subscription_id is null
  and current_period_ends_at is null
  and trial_ends_at is null;
