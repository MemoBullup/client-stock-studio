-- Bloque C: QR/etiquetas, informes, dashboard. Además: fotos de producto desde Capturar.

-- 1) La sincronización de fotos solo puede cambiar photo_status, aunque el Editor no pueda editar un SKU confirmado.
create or replace function public.variants_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin boolean := auth.uid() is null or public.has_role(auth.uid(),'admin');
  v_photo public.photo_status;
begin
  if TG_OP = 'UPDATE' and coalesce(current_setting('aly.photo_sync', true), '') = 'on' then
    v_photo := NEW.photo_status;
    NEW := OLD;
    NEW.photo_status := v_photo;
    NEW.updated_at := now();
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    NEW.sku := null;
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
    NEW.version := 1;
    if not v_admin then
      if NEW.record_status = 'archived' then raise exception 'Solo un Administrador puede archivar productos'; end if;
      NEW.review_status := 'pending';
      if NEW.photo_status = 'approved' then NEW.photo_status := 'pending'; end if;
    end if;
  else
    if NEW.sku is distinct from OLD.sku then
      raise exception 'El SKU no puede modificarse';
    end if;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.idempotency_key := OLD.idempotency_key;
    if OLD.record_status <> 'draft' and NEW.record_status = 'draft' then
      raise exception 'Un registro confirmado no puede volver a borrador';
    end if;
    if not v_admin then
      if OLD.record_status <> 'draft' then
        raise exception 'Este registro ya fue confirmado. Solicita la corrección al Administrador.';
      end if;
      if NEW.record_status = 'archived' then raise exception 'Solo un Administrador puede archivar productos'; end if;
      if NEW.review_status is distinct from OLD.review_status then raise exception 'Solo un Administrador puede validar registros'; end if;
      if NEW.photo_status = 'approved' and OLD.photo_status <> 'approved' then raise exception 'Solo un Administrador puede aprobar fotografías'; end if;
    end if;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  end if;
  if NEW.record_status = 'registered' and NEW.sku is null then
    NEW.sku := public.generate_sku();
    NEW.confirmed_at := now();
    NEW.confirmed_by := auth.uid();
  end if;
  if NEW.record_status = 'archived' and (TG_OP = 'INSERT' or OLD.record_status <> 'archived') then
    NEW.archived_at := now();
    NEW.archived_by := auth.uid();
  end if;
  return NEW;
end $$;
revoke execute on function public.variants_before_write() from public, anon, authenticated;

-- 2) Quién puede agregar fotos: Administrador, o quien capturó el SKU mientras sus fotos no estén aprobadas.
create or replace function public.can_manage_variant_images(_variant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.variants v
    where v.id = _variant_id and public.is_staff(auth.uid()) and v.record_status <> 'archived'
      and (public.has_role(auth.uid(),'admin') or (v.created_by = auth.uid() and v.photo_status <> 'approved'))
  )
$$;
revoke execute on function public.can_manage_variant_images(uuid) from public, anon;
grant execute on function public.can_manage_variant_images(uuid) to authenticated;

create or replace function public.can_upload_variant_photo(_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    v_id := split_part(_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return public.can_manage_variant_images(v_id);
end $$;
revoke execute on function public.can_upload_variant_photo(text) from public, anon;
grant execute on function public.can_upload_variant_photo(text) to authenticated;

drop policy if exists "Admin o borrador propio gestiona imágenes" on public.variant_images;
create policy "Personal agrega fotos a sus SKU" on public.variant_images for insert to authenticated
  with check (public.can_manage_variant_images(variant_id) and uploaded_by = auth.uid());
create policy "Admin o autor edita fotos" on public.variant_images for update to authenticated
  using (public.has_role(auth.uid(),'admin') or (uploaded_by = auth.uid() and public.can_manage_variant_images(variant_id)))
  with check (public.has_role(auth.uid(),'admin') or (uploaded_by = auth.uid() and public.can_manage_variant_images(variant_id)));
create policy "Admin o autor borra fotos" on public.variant_images for delete to authenticated
  using (public.has_role(auth.uid(),'admin') or (uploaded_by = auth.uid() and public.can_manage_variant_images(variant_id)));

create or replace function public.variant_images_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.uploaded_by := auth.uid();
  NEW.uploaded_at := now();
  NEW.is_demo := coalesce((select is_demo from public.variants where id = NEW.variant_id), false);
  if NEW.storage_path not like NEW.variant_id::text || '/%'
     or (NEW.thumbnail_path is not null and NEW.thumbnail_path not like NEW.variant_id::text || '/%') then
    raise exception 'Ruta de imagen inválida';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('img:' || NEW.variant_id::text, 0));
  NEW.is_primary := not exists (select 1 from public.variant_images where variant_id = NEW.variant_id and is_primary);
  NEW.sort_order := coalesce((select max(sort_order) + 1 from public.variant_images where variant_id = NEW.variant_id), 0);
  return NEW;
end $$;
revoke execute on function public.variant_images_before_insert() from public, anon, authenticated;
create trigger variant_images_before_insert before insert on public.variant_images
  for each row execute function public.variant_images_before_insert();

create or replace function public.sync_variant_photo_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_has boolean;
begin
  v_id := case when TG_OP = 'DELETE' then OLD.variant_id else NEW.variant_id end;
  if TG_OP = 'DELETE' and OLD.is_primary then
    update public.variant_images set is_primary = true
    where id = (select id from public.variant_images where variant_id = v_id order by sort_order, uploaded_at limit 1);
  end if;
  v_has := exists (select 1 from public.variant_images where variant_id = v_id);
  perform set_config('aly.photo_sync', 'on', true);
  update public.variants set photo_status = case when v_has then 'uploaded'::public.photo_status else 'pending'::public.photo_status end
  where id = v_id and ((v_has and photo_status = 'pending') or (not v_has and photo_status <> 'pending'));
  perform set_config('aly.photo_sync', '', true);
  return null;
end $$;
revoke execute on function public.sync_variant_photo_status() from public, anon, authenticated;
create trigger variant_images_sync after insert or delete on public.variant_images
  for each row execute function public.sync_variant_photo_status();

create or replace function public.set_primary_image(_image_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_img public.variant_images;
begin
  select * into v_img from public.variant_images where id = _image_id;
  if v_img.id is null then raise exception 'La fotografía ya no existe'; end if;
  if not public.can_manage_variant_images(v_img.variant_id) then
    raise exception 'No tienes permiso para cambiar las fotografías de este SKU';
  end if;
  update public.variant_images set is_primary = false where variant_id = v_img.variant_id and is_primary and id <> _image_id;
  update public.variant_images set is_primary = true where id = _image_id;
end $$;
revoke execute on function public.set_primary_image(uuid) from public, anon;
grant execute on function public.set_primary_image(uuid) to authenticated;

-- Almacenamiento privado de fotografías (bucket product-photos). Ruta: <variant_id>/<archivo>.
create policy "Personal ve fotos de producto" on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and public.is_staff(auth.uid()));
create policy "Personal sube fotos de sus SKU" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and public.can_upload_variant_photo(name));
create policy "Admin o autor borra fotos de producto" on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (public.has_role(auth.uid(),'admin') or owner = auth.uid()));

-- 3) Rutas legibles.
create or replace function public.category_path_names(_id uuid)
returns text[] language sql stable set search_path = public as $$
  with recursive up as (
    select id, parent_id, name, 1 as lvl from public.categories where id = _id
    union all
    select c.id, c.parent_id, c.name, up.lvl + 1 from public.categories c join up on c.id = up.parent_id where up.lvl < 12
  )
  select coalesce(array_agg(name order by lvl desc), '{}'::text[]) from up
$$;

create or replace function public.location_path_text(_id uuid)
returns text language sql stable set search_path = public as $$
  with recursive up as (
    select id, parent_id, name, 1 as lvl from public.locations where id = _id
    union all
    select l.id, l.parent_id, l.name, up.lvl + 1 from public.locations l join up on l.id = up.parent_id where up.lvl < 12
  )
  select string_agg(name, ' › ' order by lvl desc) from up
$$;

-- 4) Datos para etiquetas (RLS del usuario; sin costos ni cantidades).
create or replace function public.label_data(_ids uuid[])
returns table(id uuid, sku text, product_name text, variant_label text, defining_text text, details text,
  record_status public.record_status)
language sql stable security invoker set search_path = public as $$
  with vals as (
    select av.variant_id,
      case when a.data_type = 'number' then trim_scale(av.value_number)::text || coalesce(' ' || coalesce(u.symbol, u.name_plural), '')
           when a.data_type = 'multiselect' then array_to_string(av.value_options, ', ')
           else av.value_text end as txt,
      coalesce(pta.is_variant_defining, false) as defining,
      coalesce(pta.sort_order, a.sort_order) as sort
    from public.variant_attribute_values av
    join public.variants v on v.id = av.variant_id
    join public.products p on p.id = v.product_id
    join public.attributes a on a.id = av.attribute_id
    left join public.product_type_attributes pta on pta.attribute_id = a.id and pta.product_type_id = p.product_type_id
    left join public.units u on u.id = av.unit_id
    where av.variant_id = any(_ids[1:500]) and av.value_state = 'value'
      and a.code not in ('presentacion', 'contenido_presentacion')
  )
  select v.id, v.sku, p.name, v.variant_label,
    (select string_agg(x.txt, ' · ' order by x.sort) from vals x where x.variant_id = v.id and x.defining),
    (select string_agg(y.txt, ' · ' order by y.sort) from (
       select x.txt, x.sort from vals x where x.variant_id = v.id and not x.defining order by x.sort limit 3) y),
    v.record_status
  from public.variants v join public.products p on p.id = v.product_id
  where v.id = any(_ids[1:500])
  order by array_position(_ids, v.id)
$$;
revoke execute on function public.label_data(uuid[]) from public, anon;
grant execute on function public.label_data(uuid[]) to authenticated;

-- 5) Dashboard operativo (sin información económica).
create or replace function public.dashboard_overview(_today_start timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_uid uuid := auth.uid(); v jsonb;
begin
  if v_uid is null or not public.is_staff(v_uid) then raise exception 'Sin permiso'; end if;
  with recursive tree as (
    select c.id, c.id as root_id from public.categories c where c.parent_id is null
    union all
    select c.id, t.root_id from public.categories c join tree t on c.parent_id = t.id
  ), reg as (
    select v.id, v.review_status, v.photo_status, v.confirmed_at, p.category_id,
      exists (select 1 from public.stock_levels s where s.variant_id = v.id) as counted
    from public.variants v join public.products p on p.id = v.product_id
    where v.record_status = 'registered'
  ), by_root as (
    select t.root_id, count(r.id) as skus, count(r.id) filter (where r.counted) as counted,
      count(r.id) filter (where r.photo_status <> 'pending') as photographed
    from reg r join tree t on t.id = r.category_id group by t.root_id
  )
  select jsonb_build_object(
    'registered', (select count(*) from reg),
    'pending_review', (select count(*) from reg where review_status = 'pending'),
    'pending_count', (select count(*) from reg where not counted),
    'pending_photo', (select count(*) from reg where photo_status = 'pending'),
    'today', (select count(*) from reg where confirmed_at >= _today_start),
    'my_drafts', (select count(*) from public.variants where record_status = 'draft' and created_by = v_uid),
    'unclassified', jsonb_build_object(
      'skus', (select count(*) from reg where category_id is null),
      'counted', (select count(*) from reg where category_id is null and counted)),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'skus', coalesce(b.skus, 0),
        'counted', coalesce(b.counted, 0), 'photographed', coalesce(b.photographed, 0))
        order by coalesce(b.skus, 0) desc, c.sort_order, c.name)
      from public.categories c left join by_root b on b.root_id = c.id
      where c.parent_id is null and c.is_active), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke execute on function public.dashboard_overview(timestamptz) from public, anon;
grant execute on function public.dashboard_overview(timestamptz) to authenticated;

-- 6) Dashboard del Administrador: costos pendientes, valoración parcial y cobertura, actividad.
create or replace function public.admin_dashboard(_today_start timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Solo el Administrador puede ver esta información';
  end if;
  with tot as (
    select s.variant_id, sum(s.quantity) as qty from public.stock_levels s group by s.variant_id
  ), reg as (
    select v.id, v.base_unit_id, t.qty, c.cost_per_base_unit as cost, c.currency
    from public.variants v
    left join tot t on t.variant_id = v.id
    left join public.variant_costs c on c.variant_id = v.id
    where v.record_status = 'registered'
  )
  select jsonb_build_object(
    'registered', (select count(*) from reg),
    'cost_pending', (select count(*) from reg where cost is null),
    'counted', (select count(*) from reg where qty is not null),
    'valued', (select count(*) from reg where qty is not null and cost is not null),
    'counted_without_cost', (select count(*) from reg where qty is not null and cost is null),
    'valuation', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'value', val, 'skus', n) order by currency)
       from (select currency, sum(qty * cost) as val, count(*) as n from reg
             where qty is not null and cost is not null group by currency) x), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(a order by (a->>'total')::int desc) from (
       select jsonb_build_object(
         'user_id', u.uid,
         'name', coalesce(nullif(pr.full_name, ''), pr.email, 'Usuario'),
         'total', count(v.id) filter (where v.record_status = 'registered'),
         'today', count(v.id) filter (where v.record_status = 'registered' and v.confirmed_at >= _today_start),
         'week', count(v.id) filter (where v.record_status = 'registered' and v.confirmed_at >= _today_start - interval '6 days'),
         'drafts', count(v.id) filter (where v.record_status = 'draft'),
         'counts_today', (select count(*) from public.stock_counts sc where sc.counted_by = u.uid and sc.counted_at >= _today_start)
       ) as a
       from (select distinct created_by as uid from public.variants where created_by is not null
             union select distinct counted_by from public.stock_counts where counted_by is not null) u
       left join public.profiles pr on pr.id = u.uid
       left join public.variants v on v.created_by = u.uid
       group by u.uid, pr.full_name, pr.email
       limit 100) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke execute on function public.admin_dashboard(timestamptz) from public, anon;
grant execute on function public.admin_dashboard(timestamptz) to authenticated;

-- 7) Informes (solo Administrador). Devuelven páginas en jsonb para no toparse con el límite de filas.
create or replace function public._missing_data(_variant_id uuid, _with_cost boolean)
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when p.category_id is null then 'Por clasificar' end,
    (select 'Atributos con dato pendiente: ' || string_agg(a.name, ', ' order by a.sort_order)
       from public.variant_attribute_values av join public.attributes a on a.id = av.attribute_id
       where av.variant_id = v.id and av.value_state = 'pending' having count(*) > 0),
    (select 'Obligatorios sin capturar: ' || string_agg(a.name, ', ' order by pta.sort_order)
       from public.product_type_attributes pta join public.attributes a on a.id = pta.attribute_id
       where pta.product_type_id = p.product_type_id and pta.is_required
         and not exists (select 1 from public.variant_attribute_values av where av.variant_id = v.id and av.attribute_id = a.id)
       having count(*) > 0),
    case when v.presentation_unit_id is not null and v.units_per_presentation is null then 'Contenido por presentación pendiente' end,
    case when not exists (select 1 from public.stock_levels s where s.variant_id = v.id) then 'Pendiente de conteo' end,
    case when _with_cost and not exists (select 1 from public.variant_costs c where c.variant_id = v.id) then 'Costo pendiente' end
  ], null)
  from public.variants v join public.products p on p.id = v.product_id
  where v.id = _variant_id
$$;
revoke execute on function public._missing_data(uuid, boolean) from public, anon, authenticated;

create or replace function public._export_row(_variant_id uuid, _with_cost boolean, _with_missing boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', v.id, 'sku', v.sku, 'product_id', p.id, 'product_name', p.name, 'variant_label', v.variant_label,
    'product_type', pt.name,
    'categories', to_jsonb(public.category_path_names(p.category_id)),
    'attributes', coalesce((select jsonb_object_agg(a.name,
        case av.value_state
          when 'not_applicable' then 'No aplica'
          when 'pending' then 'Dato pendiente'
          else case when a.data_type = 'number' then trim_scale(av.value_number)::text || coalesce(' ' || coalesce(u2.symbol, u2.name_plural), '')
                    when a.data_type = 'multiselect' then array_to_string(av.value_options, ', ')
                    else av.value_text end
        end)
      from public.variant_attribute_values av join public.attributes a on a.id = av.attribute_id
      left join public.units u2 on u2.id = av.unit_id where av.variant_id = v.id), '{}'::jsonb),
    'base_unit', u.name_plural, 'allows_decimal', u.allows_decimal,
    'presentation_unit', pu.name_singular, 'units_per_presentation', v.units_per_presentation,
    'total_quantity', (select sum(s.quantity) from public.stock_levels s where s.variant_id = v.id),
    'locations', (select string_agg(public.location_path_text(s.location_id) || ': ' || trim_scale(s.quantity)::text, '; ' order by 1)
       from public.stock_levels s where s.variant_id = v.id),
    'record_status', v.record_status, 'review_status', v.review_status, 'photo_status', v.photo_status,
    'images', coalesce((select jsonb_agg(i.storage_path order by i.is_primary desc, i.sort_order)
       from public.variant_images i where i.variant_id = v.id), '[]'::jsonb),
    'supplier_code', v.supplier_code, 'legacy_code', v.legacy_code,
    'usage_tags', array_to_string(p.usage_tags, ', '), 'description', p.description,
    'created_by_name', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = v.created_by),
    'created_at', v.created_at, 'confirmed_at', v.confirmed_at, 'updated_at', v.updated_at,
    'is_demo', v.is_demo,
    'missing', case when _with_missing then to_jsonb(public._missing_data(v.id, _with_cost)) end,
    'cost', case when _with_cost then c.cost_per_base_unit end,
    'currency', case when _with_cost then c.currency end,
    'cost_updated_at', case when _with_cost then c.updated_at end
  )
  from public.variants v
  join public.products p on p.id = v.product_id
  left join public.product_types pt on pt.id = p.product_type_id
  join public.units u on u.id = v.base_unit_id
  left join public.units pu on pu.id = v.presentation_unit_id
  left join public.variant_costs c on c.variant_id = v.id
  where v.id = _variant_id
$$;
revoke execute on function public._export_row(uuid, boolean, boolean) from public, anon, authenticated;

create or replace function public.export_report(_kind text, _ids uuid[] default null, _include_costs boolean default false,
  _offset int default 0, _limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[]; v_total int; v_rows jsonb; v_lim int := least(greatest(coalesce(_limit, 500), 1), 1000);
  v_off int := greatest(coalesce(_offset, 0), 0);
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'Solo el Administrador puede descargar informes';
  end if;

  if _kind = 'by_location' then
    select count(*) into v_total from public.stock_levels s join public.variants v on v.id = s.variant_id
      where v.record_status <> 'draft';
    select coalesce(jsonb_agg(r.j order by r.sku nulls last, r.loc), '[]'::jsonb) into v_rows from (
      select v.sku, public.location_path_text(s.location_id) as loc, jsonb_build_object(
        'id', v.id, 'sku', v.sku, 'product_name', p.name, 'variant_label', v.variant_label,
        'location', public.location_path_text(s.location_id), 'quantity', s.quantity,
        'base_unit', u.name_plural, 'record_status', v.record_status,
        'counted_at', s.counted_at,
        'counted_by_name', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = s.counted_by),
        'is_demo', v.is_demo,
        'cost', case when _include_costs then c.cost_per_base_unit end,
        'currency', case when _include_costs then c.currency end) as j
      from public.stock_levels s
      join public.variants v on v.id = s.variant_id
      join public.products p on p.id = v.product_id
      join public.units u on u.id = v.base_unit_id
      left join public.variant_costs c on c.variant_id = v.id
      where v.record_status <> 'draft'
      order by v.sku nulls last, 2
      offset v_off limit v_lim) r;
    return jsonb_build_object('total', v_total, 'rows', v_rows);
  end if;

  if _kind = 'catalog' then
    v_ids := array(select id from public.variants where record_status <> 'draft' order by sku nulls last, created_at);
  elsif _kind = 'ids' then
    v_ids := coalesce(_ids, '{}'::uuid[]);
  elsif _kind = 'pending_count' then
    v_ids := array(select v.id from public.variants v where v.record_status = 'registered'
      and not exists (select 1 from public.stock_levels s where s.variant_id = v.id) order by v.sku);
  elsif _kind = 'pending_photo' then
    v_ids := array(select v.id from public.variants v where v.record_status = 'registered' and v.photo_status = 'pending'
      order by (select min(public.location_path_text(s.location_id)) from public.stock_levels s where s.variant_id = v.id) nulls last, v.sku);
  elsif _kind = 'incomplete' then
    v_ids := array(select v.id from public.variants v where v.record_status = 'registered'
      and cardinality(public._missing_data(v.id, _include_costs)) > 0 order by v.sku);
  else
    raise exception 'Tipo de informe desconocido';
  end if;

  v_total := coalesce(cardinality(v_ids), 0);
  select coalesce(jsonb_agg(public._export_row(x.id, _include_costs, _kind = 'incomplete') order by x.ord), '[]'::jsonb)
    into v_rows
  from (select id, ord from unnest(v_ids) with ordinality as t(id, ord) order by ord offset v_off limit v_lim) x
  where exists (select 1 from public.variants where id = x.id);
  return jsonb_build_object('total', v_total, 'rows', v_rows,
    'attribute_names', (select coalesce(jsonb_agg(name order by sort_order, name), '[]'::jsonb) from public.attributes));
end $$;
revoke execute on function public.export_report(text, uuid[], boolean, int, int) from public, anon;
grant execute on function public.export_report(text, uuid[], boolean, int, int) to authenticated;
