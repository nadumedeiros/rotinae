-- Permite paginação responsiva no histórico financeiro: 5 itens no mobile
-- e 10 no desktop. Mantém 10 como default para clientes antigos.
create or replace function public.list_manual_payments(
  p_page integer default 1,
  p_page_size integer default 10,
  p_period text default null,
  p_status text default null,
  p_query text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := coalesce(p_page_size, 10);
  v_period_start date;
  v_period_end date;
  v_total integer;
  v_items jsonb;
  v_summary jsonb;
begin
  if v_page_size not in (5, 10) then
    raise exception 'PAYMENT_PAGE_SIZE_INVALID: page size must be 5 or 10'
      using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'received', 'overdue', 'cancelled') then
    raise exception 'PAYMENT_STATUS_INVALID: invalid status' using errcode = '22023';
  end if;
  if p_period is not null and p_period !~ '^\d{4}(-\d{2})?$' then
    raise exception 'PAYMENT_PERIOD_INVALID: period must be YYYY or YYYY-MM' using errcode = '22023';
  end if;

  if length(coalesce(p_period, '')) = 4 then
    v_period_start := make_date(p_period::integer, 1, 1);
    v_period_end := v_period_start + interval '1 year';
  elsif length(coalesce(p_period, '')) = 7 then
    v_period_start := to_date(p_period || '-01', 'YYYY-MM-DD');
    if to_char(v_period_start, 'YYYY-MM') <> p_period then
      raise exception 'PAYMENT_PERIOD_INVALID: invalid month' using errcode = '22023';
    end if;
    v_period_end := v_period_start + interval '1 month';
  end if;

  select count(*)::integer
    into v_total
  from public.manual_payments payment
  join public.clients client on client.id = payment.client_id
  where (v_period_start is null or (payment.due_date >= v_period_start and payment.due_date < v_period_end))
    and (p_status is null or payment.status = p_status)
    and (nullif(btrim(p_query), '') is null
      or payment.origin ilike '%' || btrim(p_query) || '%'
      or client.name ilike '%' || btrim(p_query) || '%');

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
    into v_items
  from (
    select to_jsonb(payment) || jsonb_build_object(
      'client_name', client.name,
      'has_receipt', exists (
        select 1 from public.manual_payments receipt
        where receipt.parent_payment_id = payment.id and receipt.kind = 'receipt'
      )
    ) as row_data,
    payment.created_at
    from public.manual_payments payment
    join public.clients client on client.id = payment.client_id
    where (v_period_start is null or (payment.due_date >= v_period_start and payment.due_date < v_period_end))
      and (p_status is null or payment.status = p_status)
      and (nullif(btrim(p_query), '') is null
        or payment.origin ilike '%' || btrim(p_query) || '%'
        or client.name ilike '%' || btrim(p_query) || '%')
    order by payment.created_at desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) page_rows;

  select jsonb_build_object(
    'receivedTotalCents', coalesce(sum(payment.value_cents) filter (where payment.status = 'received'), 0),
    'pendingTotalCents', coalesce(sum(payment.value_cents) filter (where payment.status = 'pending'), 0),
    'pendingCount', count(*) filter (where payment.status = 'pending')
  )
    into v_summary
  from public.manual_payments payment
  where v_period_start is null or (payment.due_date >= v_period_start and payment.due_date < v_period_end);

  return jsonb_build_object(
    'items', v_items,
    'page', v_page,
    'pageSize', v_page_size,
    'totalItems', v_total,
    'totalPages', greatest(1, ceil(v_total::numeric / v_page_size)::integer),
    'summary', v_summary
  );
end;
$$;

revoke all on function public.list_manual_payments(integer, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.list_manual_payments(integer, integer, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
