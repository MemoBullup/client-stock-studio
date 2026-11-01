
create type public.adjustment_mode as enum ('set','increase','decrease');

-- Solicitudes de ajuste (los Editores proponen; el Administrador aplica)
create table public.stock_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  mode public.adjustment_mode not null,
  quantity numeric not null check (quantity >= 0),
  reason text not null check (length(trim(reason)) between 3 and 500),
  source_text text check (length(source_text) <= 1000),
  ai_proposal jsonb,
  status public.request_status not null default 'open',
  requested_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 500),
  applied_adjustment_id uuid references public.stock_adjustments(id) on delete set null,
  is_demo boolean not null default false
);
create index stock_adjustment_requests_status_idx on public.stock_adjustment_requests(status, created_at desc);
grant select, insert on public.stock_adjustment_requests to authenticated;
grant all on public.stock_adjustment_requests to service_role;
alter table public.stock_adjustment_requests enable row level security;
create policy "Ver solicitudes de ajuste propias o todas si es admin" on public.stock_adjustment_requests
  for select to authenticated using (requested_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "Personal crea solicitudes de ajuste" on public.stock_adjustment_requests
  for insert to authenticated with check (public.is_staff(auth.uid()) and requested_by = auth.uid() and status = 'open'
    and reviewed_by is null and applied_adjustment_id is null);
create trigger audit_adjustment_requests after insert or update on public.stock_adjustment_requests
  for each row execute function public.audit_trigger();

-- Aplica un ajuste (solo Administrador). Requiere conteo previo, motivo y nunca deja negativos.
create or replace function public.apply_stock_adjustment(
  _variant_id uuid, _location_id uuid, _mode public.adjustment_mode, _quantity numeric, _reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_prev numeric; v_new numeric; v_id uuid; v_status public.record_status;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede ajustar existencias'; end if;
  if _quantity is null or _quantity < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  if length(trim(coalesce(_reason,''))) < 3 then raise exception 'Escribe el motivo del ajuste'; end if;
  select record_status into v_status from public.variants where id = _variant_id;
  if v_status is distinct from 'registered' then raise exception 'Solo se ajustan SKU confirmados'; end if;
  select quantity into v_prev from public.stock_levels where variant_id = _variant_id and location_id = _location_id for update;
  if v_prev is null then
    raise exception 'Este SKU está pendiente de conteo en esa ubicación. Registra primero el conteo inicial.';
  end if;
  v_new := case _mode when 'set' then _quantity when 'increase' then v_prev + _quantity else v_prev - _quantity end;
  if v_new < 0 then
    raise exception 'El ajuste dejaría existencias negativas (hay %).', v_prev;
  end if;
  update public.stock_levels set quantity = v_new, updated_at = now(), updated_by = auth.uid()
    where variant_id = _variant_id and location_id = _location_id;
  insert into public.stock_adjustments(variant_id, location_id, previous_quantity, new_quantity, reason, created_by)
    values (_variant_id, _location_id, v_prev, v_new, trim(_reason), auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.apply_stock_adjustment(uuid, uuid, public.adjustment_mode, numeric, text) from public, anon;
grant execute on function public.apply_stock_adjustment(uuid, uuid, public.adjustment_mode, numeric, text) to authenticated;

create or replace function public.review_adjustment_request(_id uuid, _approve boolean, _note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.stock_adjustment_requests; v_adj uuid;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede revisar solicitudes'; end if;
  select * into r from public.stock_adjustment_requests where id = _id for update;
  if r.id is null then raise exception 'La solicitud no existe'; end if;
  if r.status <> 'open' then raise exception 'Esta solicitud ya fue revisada'; end if;
  if _approve then
    v_adj := public.apply_stock_adjustment(r.variant_id, r.location_id, r.mode, r.quantity,
      r.reason || coalesce(' · ' || nullif(trim(_note), ''), ''));
  end if;
  update public.stock_adjustment_requests
    set status = case when _approve then 'resolved'::public.request_status else 'rejected'::public.request_status end,
        reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(_note), ''), applied_adjustment_id = v_adj
    where id = _id;
  return v_adj;
end $$;
revoke execute on function public.review_adjustment_request(uuid, boolean, text) from public, anon;
grant execute on function public.review_adjustment_request(uuid, boolean, text) to authenticated;

-- Candidatos de SKU para un texto libre (respeta permisos del usuario; sin costos)
create or replace function public.suggest_variant_candidates(_text text, _limit int default 30)
returns table (
  id uuid, sku text, product_name text, variant_label text, product_type text,
  attributes text, unit_singular text, unit_plural text, allows_decimal boolean, score int
)
language sql stable security invoker set search_path = public, extensions as $$
  with tokens as (
    select distinct t from regexp_split_to_table(extensions.unaccent(lower(coalesce(_text, ''))), '[^a-z0-9]+') as t
    where length(t) >= 2 and t not in (
      'de','la','el','en','los','las','del','con','por','para','una','uno','unos','unas','hay','mas','menos','que','se',
      'al','lo','le','me','mi','su','sus','es','son','ya','no','si','fue','caja','estante','pasillo','bodega','tienda',
      'piezas','pieza','metros','metro','rollos','rollo','paquetes','paquete','faltan','sobran','encontre','conte','agregar',
      'quitar','ajuste','ajustar','inventario','quedan','tengo','tenemos','solo','total'
    )
  ), docs as (
    select v.id, v.sku, p.name as pname, v.variant_label, pt.name as ptype, u.name_singular, u.name_plural, u.allows_decimal,
      coalesce((
        select string_agg(a.name || ': ' || coalesce(av.value_text, trim(to_char(av.value_number, 'FM999999990.###')) || coalesce(' ' || mu.symbol, ''), array_to_string(av.value_options, ', ')), '; ')
        from public.variant_attribute_values av
        join public.attributes a on a.id = av.attribute_id
        left join public.units mu on mu.id = av.unit_id
        where av.variant_id = v.id and av.value_state = 'value'
      ), '') as attrs
    from public.variants v
    join public.products p on p.id = v.product_id
    left join public.product_types pt on pt.id = p.product_type_id
    join public.units u on u.id = v.base_unit_id
    where v.record_status = 'registered'
  ), scored as (
    select d.*, (
      select count(*) from tokens tk
      where extensions.unaccent(lower(coalesce(d.sku, '') || ' ' || d.pname || ' ' || coalesce(d.variant_label, '') || ' ' || coalesce(d.ptype, '') || ' ' || d.attrs)) like '%' || tk.t || '%'
    )::int as score
    from docs d
  )
  select s.id, s.sku, s.pname, s.variant_label, s.ptype, s.attrs, s.name_singular, s.name_plural, s.allows_decimal, s.score
  from scored s
  where s.score > 0
  order by s.score desc, s.sku
  limit least(greatest(coalesce(_limit, 30), 1), 60)
$$;
revoke execute on function public.suggest_variant_candidates(text, int) from public, anon;
grant execute on function public.suggest_variant_candidates(text, int) to authenticated;
