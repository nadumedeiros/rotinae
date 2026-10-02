-- Finaliza no Mercado Pago os cancelamentos agendados cujo período de acesso
-- já terminou. O segredo é criado no banco e nunca chega ao cliente ou ao Git.
create table public.subscription_finalization_config (
  id boolean primary key default true check (id),
  secret text not null,
  created_at timestamptz not null default now()
);

alter table public.subscription_finalization_config enable row level security;
revoke all on public.subscription_finalization_config from public, anon, authenticated;
grant select on public.subscription_finalization_config to service_role;

insert into public.subscription_finalization_config (id, secret)
values (true, encode(extensions.gen_random_bytes(32), 'hex'));

select cron.schedule(
  'rotinae-finalize-subscription-cancellations',
  '7 * * * *',
  $$
    select net.http_post(
      url := 'https://dgrnymniplveemkilcjr.supabase.co/functions/v1/finalize-subscription-cancellations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-rotinae-subscription-secret',
        (select secret from public.subscription_finalization_config where id)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
  $$
);
