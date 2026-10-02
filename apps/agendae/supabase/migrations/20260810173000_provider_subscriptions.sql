create table public.provider_subscriptions (
  provider_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  mercado_pago_subscription_id text unique,
  status text not null default 'free' check (status in ('free', 'pending', 'trialing', 'active', 'paused', 'past_due', 'canceled')),
  payer_email text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  next_payment_at timestamptz,
  payment_method_label text,
  checkout_url text,
  last_mercado_pago_payload jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger provider_subscriptions_set_updated_at
  before update on public.provider_subscriptions
  for each row execute function public.set_updated_at();

alter table public.provider_subscriptions enable row level security;

create policy "provider_subscriptions_select_owner"
  on public.provider_subscriptions for select to authenticated
  using (auth.uid() = provider_user_id);

create table public.subscription_idempotency_keys (
  provider_user_id uuid not null references public.profiles(user_id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  primary key (provider_user_id, idempotency_key)
);

alter table public.subscription_idempotency_keys enable row level security;

create index provider_subscriptions_status_idx on public.provider_subscriptions(status);
