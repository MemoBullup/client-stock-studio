
-- Niveles mínimos por variante y ubicación
create table public.stock_minimums (
  variant_id uuid not null references public.variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  min_quantity numeric not null check (min_quantity >= 0),
  notes text check (length(notes) <= 300),
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (variant_id, location_id)
);
create index stock_minimums_location_idx on public.stock_minimums(location_id);
grant select, insert, update, delete on public.stock_minimums to authenticated;
grant all on public.stock_minimums to service_role;
alter table public.stock_minimums enable row level security;
create policy "Personal ve mínimos" on public.stock_minimums for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin crea mínimos" on public.stock_minimums for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "Admin edita mínimos" on public.stock_minimums for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "Admin elimina mínimos" on public.stock_minimums for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.stock_minimums_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dec boolean; v_status public.record_status;
begin
  select u.allows_decimal, v.record_status into v_dec, v_status
  from public.variants v join public.units u on u.id = v.base_unit_id where v.id = NEW.variant_id;
  if v_status = 'archived' then
    raise exception 'No se pueden configurar mínimos para un SKU archivado';
  end if;
  if not coalesce(v_dec, false) and NEW.min_quantity <> trunc(NEW.min_quantity) then
    raise exception 'Esta unidad solo admite cantidades enteras';
  end if;
  if TG_OP = 'INSERT' then
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  else
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  end if;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  return NEW;
end $$;
revoke execute on function public.stock_minimums_before_write() from public, anon, authenticated;
create trigger stock_minimums_before_write before insert or update on public.stock_minimums
  for each row execute function public.stock_minimums_before_write();
create trigger audit_stock_minimums after insert or update or delete on public.stock_minimums
  for each row execute function public.audit_trigger();

-- Listado de mínimos con su existencia actual (respeta permisos del usuario).
-- Alerta = se contó y la cantidad es MENOR al mínimo. Sin conteo = pendiente, no alerta.
create or replace function public.list_stock_minimums(
  _search text default null,
  _only_alerts boolean default false,
  _limit int default 25,
  _offset int default 0
)
returns table (
  variant_id uuid,
  location_id uuid,
  sku text,
  product_name text,
  variant_label text,
  record_status public.record_status,
  min_quantity numeric,
  quantity numeric,
  unit_singular text,
  unit_plural text,
  allows_decimal boolean,
  counted_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language sql stable security invoker set search_path = public, extensions as $$
  select m.variant_id, m.location_id, v.sku, p.name, v.variant_label, v.record_status,
         m.min_quantity, s.quantity, u.name_singular, u.name_plural, u.allows_decimal,
         s.counted_at, m.updated_at, count(*) over ()
  from public.stock_minimums m
  join public.variants v on v.id = m.variant_id
  join public.products p on p.id = v.product_id
  join public.units u on u.id = v.base_unit_id
  left join public.stock_levels s on s.variant_id = m.variant_id and s.location_id = m.location_id
  where v.record_status <> 'archived'
    and (not _only_alerts or (v.record_status = 'registered' and s.quantity is not null and s.quantity < m.min_quantity))
    and (
      coalesce(trim(_search), '') = ''
      or extensions.unaccent(lower(coalesce(v.sku, '') || ' ' || p.name || ' ' || coalesce(v.variant_label, '')))
         like '%' || extensions.unaccent(lower(trim(_search))) || '%'
    )
  order by
    case when _only_alerts then (m.min_quantity - s.quantity) / nullif(m.min_quantity, 0) end desc nulls last,
    v.sku nulls last, p.name
  limit least(greatest(coalesce(_limit, 25), 1), 200)
  offset greatest(coalesce(_offset, 0), 0)
$$;
revoke execute on function public.list_stock_minimums(text, boolean, int, int) from public, anon;
grant execute on function public.list_stock_minimums(text, boolean, int, int) to authenticated;

create or replace function public.low_stock_summary()
returns table (below_count bigint, pending_count bigint, configured_count bigint)
language sql stable security invoker set search_path = public as $$
  select
    count(*) filter (where v.record_status = 'registered' and s.quantity is not null and s.quantity < m.min_quantity),
    count(*) filter (where s.quantity is null),
    count(*)
  from public.stock_minimums m
  join public.variants v on v.id = m.variant_id and v.record_status <> 'archived'
  left join public.stock_levels s on s.variant_id = m.variant_id and s.location_id = m.location_id
$$;
revoke execute on function public.low_stock_summary() from public, anon;
grant execute on function public.low_stock_summary() to authenticated;

-- Búsqueda de SKU para seleccionar una variante (respeta permisos del usuario)
create or replace function public.search_variants(_q text, _limit int default 20)
returns table (
  id uuid, sku text, product_name text, variant_label text, record_status public.record_status,
  unit_singular text, unit_plural text, allows_decimal boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select v.id, v.sku, p.name, v.variant_label, v.record_status, u.name_singular, u.name_plural, u.allows_decimal
  from public.variants v
  join public.products p on p.id = v.product_id
  join public.units u on u.id = v.base_unit_id
  where v.record_status <> 'archived'
    and (
      coalesce(trim(_q), '') = ''
      or extensions.unaccent(lower(coalesce(v.sku, '') || ' ' || p.name || ' ' || coalesce(v.variant_label, '') || ' ' || coalesce(v.supplier_code, '')))
         like '%' || extensions.unaccent(lower(trim(_q))) || '%'
    )
  order by v.sku nulls last, p.name
  limit least(greatest(coalesce(_limit, 20), 1), 50)
$$;
revoke execute on function public.search_variants(text, int) from public, anon;
grant execute on function public.search_variants(text, int) to authenticated;
