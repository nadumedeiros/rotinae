-- Histórico financeiro mensal e correção de isolamento por tenant.
--
-- Competência adotada:
--   * recebido: mês de `received_at` do recebimento real;
--   * previsto e ainda não recebido: mês de `due_date` da cobrança;
--   * cancelados: fora dos totais previstos e em aberto;
--   * pagamentos parciais: cada recibo pertence ao mês em que foi recebido.

-- Corrige a ambiguidade registrada na policy original. Dentro da subquery de
-- `clients`, `c.tenant_id = tenant_id` podia resolver os dois lados para a
-- própria tabela `clients`. A qualificação explícita mantém cliente e cobrança
-- obrigatoriamente no mesmo tenant.
drop policy if exists "manual_payments_owner_all" on public.manual_payments;

create policy "manual_payments_owner_all" on public.manual_payments
  for all to authenticated
  using (
    exists (
      select 1
      from public.tenants t
      where t.id = manual_payments.tenant_id
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenants t
      where t.id = manual_payments.tenant_id
        and t.owner_user_id = auth.uid()
    )
    and exists (
      select 1
      from public.clients c
      where c.id = manual_payments.client_id
        and c.tenant_id = manual_payments.tenant_id
    )
  );

-- Impede que uma edição posterior de descrição, vencimento ou observação
-- mova um ganho já recebido para o mês atual. A data muda somente na
-- transição real para `received`; sair desse status limpa a data.
create or replace function public.preserve_manual_payment_received_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'received' then
      new.received_at := coalesce(new.received_at, now());
    else
      new.received_at := null;
    end if;
    return new;
  end if;

  if new.status = 'received' and old.status <> 'received' then
    new.received_at := now();
  elsif new.status = 'received' and old.status = 'received' then
    new.received_at := old.received_at;
  else
    new.received_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.preserve_manual_payment_received_at() from public, anon, authenticated;

drop trigger if exists manual_payments_preserve_received_at on public.manual_payments;
create trigger manual_payments_preserve_received_at
before insert or update of status on public.manual_payments
for each row execute function public.preserve_manual_payment_received_at();

create or replace function public.get_financial_monthly_history()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_timezone text;
  v_months jsonb;
begin
  select t.id, coalesce(t.timezone, 'America/Sao_Paulo')
    into v_tenant_id, v_timezone
  from public.tenants t
  where t.owner_user_id = auth.uid()
    and t.status = 'active'
  limit 1;

  if v_tenant_id is null then
    raise exception 'FORBIDDEN: active provider tenant not found' using errcode = '42501';
  end if;

  with receipt_totals_by_charge as (
    select
      r.parent_payment_id,
      sum(r.value_cents)::bigint as received_cents
    from public.manual_payments r
    where r.tenant_id = v_tenant_id
      and r.kind = 'receipt'
      and r.status = 'received'
    group by r.parent_payment_id
  ),
  charge_months as (
    select
      date_trunc('month', c.due_date)::date as month_start,
      coalesce(sum(c.value_cents) filter (where c.status <> 'cancelled'), 0)::bigint as expected_cents,
      coalesce(sum(
        case
          when c.status in ('pending', 'overdue')
            then greatest(c.value_cents - coalesce(receipts.received_cents, 0), 0)
          else 0
        end
      ), 0)::bigint as outstanding_cents,
      count(*) filter (where c.status <> 'cancelled')::integer as charge_count,
      count(*) filter (
        where c.status in ('pending', 'overdue')
          and c.value_cents - coalesce(receipts.received_cents, 0) > 0
      )::integer as outstanding_count
    from public.manual_payments c
    left join receipt_totals_by_charge receipts on receipts.parent_payment_id = c.id
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
    group by date_trunc('month', c.due_date)::date
  ),
  received_entries as (
    select
      date_trunc(
        'month',
        coalesce(r.received_at at time zone v_timezone, r.due_date::timestamp)
      )::date as month_start,
      r.value_cents::bigint as value_cents
    from public.manual_payments r
    where r.tenant_id = v_tenant_id
      and r.kind = 'receipt'
      and r.status = 'received'

    union all

    select
      date_trunc(
        'month',
        coalesce(c.received_at at time zone v_timezone, c.due_date::timestamp)
      )::date as month_start,
      c.value_cents::bigint as value_cents
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
      and c.status = 'received'
      and not exists (
        select 1
        from public.manual_payments child
        where child.parent_payment_id = c.id
          and child.kind = 'receipt'
      )
  ),
  received_months as (
    select month_start, sum(value_cents)::bigint as received_cents
    from received_entries
    group by month_start
  ),
  all_months as (
    select month_start from charge_months
    union
    select month_start from received_months
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', to_char(months.month_start, 'YYYY-MM'),
        'receivedTotalCents', coalesce(received.received_cents, 0),
        'expectedTotalCents', coalesce(charges.expected_cents, 0),
        'outstandingTotalCents', coalesce(charges.outstanding_cents, 0),
        'chargeCount', coalesce(charges.charge_count, 0),
        'outstandingCount', coalesce(charges.outstanding_count, 0)
      )
      order by months.month_start desc
    ),
    '[]'::jsonb
  )
    into v_months
  from all_months months
  left join charge_months charges on charges.month_start = months.month_start
  left join received_months received on received.month_start = months.month_start;

  return jsonb_build_object('months', v_months);
end;
$$;

revoke all on function public.get_financial_monthly_history() from public, anon, authenticated;
grant execute on function public.get_financial_monthly_history() to authenticated;

do $$
begin
  if to_regprocedure('public.get_financial_monthly_history()') is null then
    raise exception 'get_financial_monthly_history() was not created';
  end if;
end;
$$;
