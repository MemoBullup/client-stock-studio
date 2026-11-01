
-- Consultas de solo lectura para el asistente (respetan permisos; sin costos)
create or replace function public.inventory_overview()
returns table (registered_skus bigint, counted_skus bigint, pending_count_skus bigint, zero_stock_skus bigint, active_locations bigint)
language sql stable security invoker set search_path = public as $$
  with v as (select id from public.variants where record_status = 'registered'),
  s as (select variant_id, sum(quantity) as total from public.stock_levels where variant_id in (select id from v) group by variant_id)
  select
    (select count(*) from v),
    (select count(*) from s),
    (select count(*) from v where id not in (select variant_id from s)),
    (select count(*) from s where total = 0),
    (select count(*) from public.locations where is_active)
$$;
revoke execute on function public.inventory_overview() from public, anon;
grant execute on function public.inventory_overview() to authenticated;

create or replace function public.stock_totals_by_unit()
returns table (unit_singular text, unit_plural text, total numeric, sku_count bigint)
language sql stable security invoker set search_path = public as $$
  select u.name_singular, u.name_plural, sum(s.quantity), count(distinct s.variant_id)
  from public.stock_levels s
  join public.variants v on v.id = s.variant_id and v.record_status = 'registered'
  join public.units u on u.id = v.base_unit_id
  group by u.name_singular, u.name_plural, u.sort_order
  order by u.sort_order
$$;
revoke execute on function public.stock_totals_by_unit() from public, anon;
grant execute on function public.stock_totals_by_unit() to authenticated;

create or replace function public.pending_count_variants(_limit int default 30)
returns table (id uuid, sku text, product_name text, variant_label text, unit_plural text, total_count bigint)
language sql stable security invoker set search_path = public as $$
  select v.id, v.sku, p.name, v.variant_label, u.name_plural, count(*) over ()
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.units u on u.id = v.base_unit_id
  where v.record_status = 'registered'
    and not exists (select 1 from public.stock_levels s where s.variant_id = v.id)
  order by v.sku
  limit least(greatest(coalesce(_limit, 30), 1), 100)
$$;
revoke execute on function public.pending_count_variants(int) from public, anon;
grant execute on function public.pending_count_variants(int) to authenticated;
