-- Alinha o indicador "Previsto para o mes" com a regra operacional:
-- ele representa o saldo ainda nao recebido dos lancamentos cadastrados
-- naquela competencia, usando `created_at` no fuso do prestador.
-- Pendencias trazidas de meses anteriores continuam em `outstanding`, mas nao
-- inflam o previsto dos novos cadastros do mes atual.

create or replace function public.get_financial_monthly_history()
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_timezone text;
  v_current_month date;
  v_first_month date;
  v_last_month date;
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

  v_current_month := date_trunc('month', now() at time zone v_timezone)::date;

  with financial_dates as (
    select date_trunc('month', c.created_at at time zone v_timezone)::date as month_start
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'

    union all

    select date_trunc('month', c.due_date)::date
    from public.manual_payments c
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'

    union all

    select date_trunc(
      'month',
      coalesce(p.received_at at time zone v_timezone, p.due_date::timestamp)
    )::date
    from public.manual_payments p
    where p.tenant_id = v_tenant_id
      and p.status = 'received'
  )
  select
    least(coalesce(min(month_start), v_current_month), v_current_month),
    greatest(coalesce(max(month_start), v_current_month), v_current_month)
    into v_first_month, v_last_month
  from financial_dates;

  with months as (
    select generate_series(v_first_month, v_last_month, interval '1 month')::date as month_start
  ),
  receipt_totals_by_charge as (
    select
      r.parent_payment_id,
      sum(r.value_cents)::bigint as received_cents
    from public.manual_payments r
    where r.tenant_id = v_tenant_id
      and r.kind = 'receipt'
      and r.status = 'received'
    group by r.parent_payment_id
  ),
  open_charges as (
    select
      c.id,
      c.due_date,
      date_trunc('month', c.created_at at time zone v_timezone)::date as registered_month,
      greatest(c.value_cents - coalesce(receipts.received_cents, 0), 0)::bigint as balance_cents
    from public.manual_payments c
    left join receipt_totals_by_charge receipts on receipts.parent_payment_id = c.id
    where c.tenant_id = v_tenant_id
      and c.kind = 'charge'
      and c.status in ('pending', 'overdue')
      and c.value_cents - coalesce(receipts.received_cents, 0) > 0
  ),
  expected_months as (
    select
      open_charges.registered_month as month_start,
      sum(open_charges.balance_cents)::bigint as expected_cents,
      count(open_charges.id)::integer as charge_count
    from open_charges
    group by open_charges.registered_month
  ),
  outstanding_months as (
    select
      months.month_start,
      coalesce(sum(open_charges.balance_cents), 0)::bigint as outstanding_cents,
      count(open_charges.id)::integer as outstanding_count
    from months
    left join open_charges on (
      (
        months.month_start <= v_current_month
        and open_charges.due_date < (months.month_start + interval '1 month')::date
      )
      or (
        months.month_start > v_current_month
        and open_charges.due_date >= months.month_start
        and open_charges.due_date < (months.month_start + interval '1 month')::date
      )
    )
    group by months.month_start
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
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', to_char(months.month_start, 'YYYY-MM'),
        'receivedTotalCents', coalesce(received.received_cents, 0),
        'expectedTotalCents', coalesce(expected.expected_cents, 0),
        'outstandingTotalCents', coalesce(outstanding.outstanding_cents, 0),
        'chargeCount', coalesce(expected.charge_count, 0),
        'outstandingCount', coalesce(outstanding.outstanding_count, 0)
      )
      order by months.month_start desc
    ),
    '[]'::jsonb
  )
    into v_months
  from months
  left join expected_months expected on expected.month_start = months.month_start
  left join outstanding_months outstanding on outstanding.month_start = months.month_start
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
