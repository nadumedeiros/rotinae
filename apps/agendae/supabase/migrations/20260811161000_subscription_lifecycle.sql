-- Cancelamento no fim do período e reconciliação autoritativa do trial.
alter table public.provider_subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.provider_subscriptions
  drop constraint if exists provider_subscriptions_status_check;
alter table public.provider_subscriptions
  add constraint provider_subscriptions_status_check check (
    status in ('free', 'pending', 'trialing', 'active', 'cancel_at_period_end', 'paused', 'past_due', 'canceled')
  );

create index if not exists subscription_idempotency_created_idx
  on public.subscription_idempotency_keys(created_at);
