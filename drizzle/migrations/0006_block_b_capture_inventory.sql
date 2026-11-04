-- Bloque B: captura rápida, variantes, conteos y consulta del inventario.

alter table public.products add column if not exists idempotency_key uuid unique;
alter table public.variants add column if not exists draft_count jsonb;

create or replace function public.variant_attrs_json(_variant_id uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'attribute_id', attribute_id, 'state', value_state, 'text', value_text,
    'number', value_number, 'options', to_jsonb(value_options), 'unit_id', unit_id)), '[]'::jsonb)
  from public.variant_attribute_values where variant_id = _variant_id
$$;

create or replace function public.variant_signature_from(_product_type_id uuid, _attrs jsonb)
returns text language sql stable set search_path = public, extensions as $$
  with defs as (
    select a.id, a.data_type from public.product_type_attributes pta
    join public.attributes a on a.id = pta.attribute_id
    where pta.product_type_id = _product_type_id and pta.is_variant_defining
  ), vals as (
    select d.id, d.data_type,
      (select e from jsonb_array_elements(coalesce(_attrs, '[]'::jsonb)) e
        where e->>'attribute_id' = d.id::text limit 1) as v
    from defs d
  )
  select case
    when not exists (select 1 from defs) then null
    when exists (select 1 from vals where v is null or coalesce(v->>'state', 'pending') not in ('value', 'not_applicable')) then null
    else (select string_agg(id::text || '=' || case
        when v->>'state' = 'not_applicable' then '-'
        when data_type = 'number' then coalesce(trim_scale((v->>'number')::numeric)::text, '')
          || coalesce((select code from public.units where id = nullif(v->>'unit_id', '')::uuid), '')
        when data_type = 'multiselect' then coalesce((select string_agg(extensions.unaccent(lower(trim(o))), ',' order by extensions.unaccent(lower(trim(o))))
          from jsonb_array_elements_text(case when jsonb_typeof(v->'options') = 'array' then v->'options' else '[]'::jsonb end) o), '')
        else extensions.unaccent(lower(trim(coalesce(v->>'text', ''))))
      end, '|' order by id) from vals)
  end
$$;

with s as (
  select v.id, v.product_id, public.variant_signature_from(p.product_type_id, public.variant_attrs_json(v.id)) as sig
  from public.variants v join public.products p on p.id = v.product_id
  where v.record_status <> 'archived' and v.defining_signature is null
), r as (
  select id, sig, row_number() over (partition by product_id, sig order by id) as rn from s where sig is not null
)
update public.variants v set defining_signature = r.sig from r
where r.id = v.id and r.rn = 1
  and not exists (select 1 from public.variants o where o.product_id = v.product_id and o.defining_signature = r.sig);

create or replace function public._record_initial_count(
  _variant_id uuid, _location_id uuid, _quantity numeric, _full numeric, _loose numeric,
  _ref text, _notes text, _idem uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_var public.variants; v_session uuid; v_qty numeric; v_factor numeric;
  v_status public.count_entry_status; v_id uuid; v_existing public.stock_counts; v_active boolean;
begin
  if _idem is not null then
    select * into v_existing from public.stock_counts where idempotency_key = _idem;
    if v_existing.id is not null then
      return jsonb_build_object('count_id', v_existing.id, 'status', v_existing.status, 'quantity', v_existing.quantity);
    end if;
  end if;
  select * into v_var from public.variants where id = _variant_id;
  if v_var.id is null or v_var.record_status <> 'registered' then raise exception 'Solo se cuentan SKU confirmados'; end if;
  select is_active into v_active from public.locations where id = _location_id;
  if v_active is null then raise exception 'Elige una ubicación válida'; end if;
  if not v_active then raise exception 'La ubicación está desactivada'; end if;
  select id into v_session from public.inventory_sessions where is_open order by started_at desc limit 1;
  if v_session is null then raise exception 'No hay una sesión de levantamiento abierta. Pide al Administrador que abra una.'; end if;
  if _full is not null or _loose is not null then
    v_factor := v_var.units_per_presentation;
    if v_factor is null then
      raise exception 'Se desconoce el contenido de cada presentación: captura la cantidad total en la unidad base o márcala como pendiente.';
    end if;
    if _full is not null and (_full < 0 or _full <> trunc(_full)) then raise exception 'Las presentaciones completas deben ser un número entero'; end if;
    if _loose is not null and _loose < 0 then raise exception 'La cantidad suelta no puede ser negativa'; end if;
    v_qty := coalesce(_full, 0) * v_factor + coalesce(_loose, 0);
  else
    v_qty := _quantity;
  end if;
  if v_qty is null then raise exception 'Escribe la cantidad contada o márcala como pendiente'; end if;
  if v_qty < 0 then raise exception 'La cantidad no puede ser negativa'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_variant_id::text || ':' || _location_id::text, 0));
  if exists (select 1 from public.stock_counts where variant_id = _variant_id and location_id = _location_id
               and session_id = v_session and status = 'confirmed')
     or exists (select 1 from public.stock_levels where variant_id = _variant_id and location_id = _location_id) then
    v_status := 'in_review';
  else
    v_status := 'confirmed';
  end if;
  insert into public.stock_counts(variant_id, location_id, session_id, quantity, full_presentations, loose_quantity,
    conversion_factor, status, capture_ref, notes, idempotency_key, counted_by, is_demo)
  values (_variant_id, _location_id, v_session, v_qty, _full, _loose,
    case when _full is not null or _loose is not null then v_factor end, v_status,
    nullif(trim(coalesce(_ref, '')), ''), nullif(trim(coalesce(_notes, '')), ''), _idem, auth.uid(), v_var.is_demo)
  returning id into v_id;
  if v_status = 'confirmed' then
    insert into public.stock_levels(variant_id, location_id, quantity, counted_at, counted_by, updated_at, updated_by, is_demo)
    values (_variant_id, _location_id, v_qty, now(), auth.uid(), now(), auth.uid(), v_var.is_demo);
  end if;
  return jsonb_build_object('count_id', v_id, 'status', v_status, 'quantity', v_qty);
end $$;
revoke execute on function public._record_initial_count(uuid, uuid, numeric, numeric, numeric, text, text, uuid) from public, anon, authenticated;

create or replace function public.record_count(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff(auth.uid()) then raise exception 'No tienes permiso para registrar conteos'; end if;
  return public._record_initial_count(
    nullif(_payload->>'variant_id', '')::uuid, nullif(_payload->>'location_id', '')::uuid,
    nullif(_payload->>'quantity', '')::numeric, nullif(_payload->>'full_presentations', '')::numeric,
    nullif(_payload->>'loose_quantity', '')::numeric, _payload->>'capture_ref', _payload->>'notes',
    nullif(_payload->>'idempotency_key', '')::uuid);
end $$;

create or replace function public.review_count(_id uuid, _accept boolean, _note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.stock_counts; v_prev numeric;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Solo un Administrador puede revisar conteos'; end if;
  select * into c from public.stock_counts where id = _id for update;
  if c.id is null then raise exception 'El conteo no existe'; end if;
  if c.status <> 'in_review' then raise exception 'Este conteo ya fue revisado'; end if;
  if _accept then
    select quantity into v_prev from public.stock_levels where variant_id = c.variant_id and location_id = c.location_id for update;
    update public.stock_counts set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
      where variant_id = c.variant_id and location_id = c.location_id and session_id = c.session_id
        and status = 'confirmed' and id <> c.id;
    update public.stock_counts set status = 'confirmed', reviewed_by = auth.uid(), reviewed_at = now() where id = c.id;
    if v_prev is null then
      insert into public.stock_levels(variant_id, location_id, quantity, counted_at, counted_by, updated_at, updated_by, is_demo)
      values (c.variant_id, c.location_id, c.quantity, c.counted_at, c.counted_by, now(), auth.uid(), c.is_demo);
    else
      update public.stock_levels set quantity = c.quantity, counted_at = c.counted_at, counted_by = c.counted_by,
        updated_at = now(), updated_by = auth.uid()
        where variant_id = c.variant_id and location_id = c.location_id;
      insert into public.stock_adjustments(variant_id, location_id, previous_quantity, new_quantity, reason, created_by, is_demo)
      values (c.variant_id, c.location_id, v_prev, c.quantity,
        'Conteo en revisión aceptado' || coalesce(' · ' || nullif(trim(_note), ''), ''), auth.uid(), c.is_demo);
    end if;
  else
    update public.stock_counts set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now() where id = c.id;
  end if;
end $$;

create or replace function public.save_capture(_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_target public.record_status;
  v_key uuid := nullif(_payload->>'idempotency_key', '')::uuid;
  v_prod jsonb := coalesce(_payload->'product', '{}'::jsonb);
  v_product public.products;
  v_cat uuid; v_type uuid; v_name text; v_tags text[];
  v_row jsonb; v_cnt jsonb; v_attr jsonb;
  v_var public.variants;
  v_was_draft boolean;
  v_sig text; v_dup text; v_label text;
  v_results jsonb := '[]'::jsonb;
  v_count jsonb;
  v_def record;
  v_idx int := 0;
  v_unit_kind public.unit_kind;
  v_state text;
begin
  if v_uid is null or not public.is_staff(v_uid) then raise exception 'No tienes permiso para capturar'; end if;
  v_admin := public.has_role(v_uid, 'admin');
  v_target := coalesce(nullif(_payload->>'status', ''), 'draft')::public.record_status;
  if v_target not in ('draft', 'registered') then raise exception 'Estado de guardado inválido'; end if;
  if v_key is null then raise exception 'Falta la clave de guardado'; end if;
  if jsonb_typeof(_payload->'variants') is distinct from 'array' or jsonb_array_length(_payload->'variants') = 0 then
    raise exception 'Agrega al menos una variante';
  end if;
  if jsonb_array_length(_payload->'variants') > 60 then raise exception 'Se permiten hasta 60 variantes por guardado'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));

  v_name := trim(coalesce(v_prod->>'name', ''));
  v_cat := nullif(v_prod->>'category_id', '')::uuid;
  v_type := nullif(v_prod->>'product_type_id', '')::uuid;
  v_tags := array(select distinct left(trim(t), 40) from jsonb_array_elements_text(
    case when jsonb_typeof(v_prod->'usage_tags') = 'array' then v_prod->'usage_tags' else '[]'::jsonb end) t where trim(t) <> '');

  if nullif(v_prod->>'id', '') is not null then
    select * into v_product from public.products where id = (v_prod->>'id')::uuid for update;
    if v_product.id is null then raise exception 'El producto ya no existe'; end if;
    if v_product.is_archived then raise exception 'El producto está archivado'; end if;
    if coalesce((v_prod->>'update')::boolean, false) then
      if not (v_admin or (v_product.created_by = v_uid and not exists (
          select 1 from public.variants where product_id = v_product.id and record_status <> 'draft'))) then
        raise exception 'Solo el Administrador puede modificar un producto confirmado';
      end if;
      if length(v_name) = 0 then raise exception 'Escribe el nombre del producto'; end if;
      update public.products set name = v_name, product_type_id = v_type, category_id = v_cat,
        description = nullif(trim(coalesce(v_prod->>'description', '')), ''), usage_tags = v_tags,
        notes = nullif(trim(coalesce(v_prod->>'notes', '')), '')
      where id = v_product.id returning * into v_product;
    end if;
  else
    select * into v_product from public.products where idempotency_key = v_key;
    if v_product.id is null then
      if length(v_name) = 0 then raise exception 'Escribe el nombre del producto'; end if;
      if length(v_name) > 160 then raise exception 'El nombre admite hasta 160 caracteres'; end if;
      if v_type is null then raise exception 'Elige el tipo de producto'; end if;
      insert into public.products(name, product_type_id, category_id, description, usage_tags, notes, created_by, idempotency_key)
      values (v_name, v_type, v_cat, nullif(trim(coalesce(v_prod->>'description', '')), ''), v_tags,
        nullif(trim(coalesce(v_prod->>'notes', '')), ''), v_uid, v_key)
      returning * into v_product;
    end if;
  end if;
  if v_product.category_id is not null and not exists (select 1 from public.categories where id = v_product.category_id and is_active) then
    raise exception 'La categoría elegida está desactivada';
  end if;

  for v_row in select value from jsonb_array_elements(_payload->'variants') loop
    v_idx := v_idx + 1;
    v_var := null;
    v_label := coalesce(nullif(trim(coalesce(v_row->>'variant_label', '')), ''), 'variante ' || v_idx);
    if nullif(v_row->>'id', '') is not null then
      select * into v_var from public.variants where id = (v_row->>'id')::uuid for update;
      if v_var.id is null then raise exception 'La variante ya no existe'; end if;
      if v_var.product_id <> v_product.id then raise exception 'La variante no pertenece a este producto'; end if;
      if v_var.record_status = 'archived' then raise exception 'La variante está archivada'; end if;
      if not (v_admin or (v_var.created_by = v_uid and v_var.record_status = 'draft')) then
        raise exception 'Este registro ya fue confirmado. Solicita la corrección al Administrador.';
      end if;
    else
      if nullif(v_row->>'idempotency_key', '') is null then raise exception 'Falta la clave de la variante'; end if;
      select * into v_var from public.variants where idempotency_key = (v_row->>'idempotency_key')::uuid;
      if v_var.id is not null then
        v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_var.id, 'sku', v_var.sku,
          'record_status', v_var.record_status, 'variant_label', v_var.variant_label, 'reused', true,
          'count', (select jsonb_build_object('status', status, 'quantity', quantity) from public.stock_counts where idempotency_key = v_var.idempotency_key)));
        continue;
      end if;
    end if;
    v_was_draft := v_var.id is null or v_var.record_status = 'draft';

    select kind into v_unit_kind from public.units where id = nullif(v_row->>'base_unit_id', '')::uuid and is_active;
    if v_unit_kind is distinct from 'inventory' then raise exception 'Elige la unidad base de %', v_label; end if;
    if nullif(v_row->>'presentation_unit_id', '') is not null and not exists (
        select 1 from public.units where id = (v_row->>'presentation_unit_id')::uuid and kind = 'inventory') then
      raise exception 'Presentación inválida en %', v_label;
    end if;
    if nullif(v_row->>'units_per_presentation', '') is not null and (v_row->>'units_per_presentation')::numeric <= 0 then
      raise exception 'El contenido por presentación debe ser mayor que cero';
    end if;
    if v_var.id is not null and v_var.base_unit_id <> (v_row->>'base_unit_id')::uuid
       and exists (select 1 from public.stock_levels where variant_id = v_var.id) then
      raise exception 'No se puede cambiar la unidad base de un SKU con existencias registradas';
    end if;

    if v_var.id is null then
      insert into public.variants(product_id, variant_label, supplier_code, legacy_code, base_unit_id, presentation_unit_id,
        units_per_presentation, notes, idempotency_key, created_by, record_status)
      values (v_product.id, nullif(trim(coalesce(v_row->>'variant_label', '')), ''), nullif(trim(coalesce(v_row->>'supplier_code', '')), ''),
        nullif(trim(coalesce(v_row->>'legacy_code', '')), ''), (v_row->>'base_unit_id')::uuid,
        nullif(v_row->>'presentation_unit_id', '')::uuid, nullif(v_row->>'units_per_presentation', '')::numeric,
        nullif(trim(coalesce(v_row->>'notes', '')), ''), (v_row->>'idempotency_key')::uuid, v_uid, 'draft')
      returning * into v_var;
    else
      update public.variants set variant_label = nullif(trim(coalesce(v_row->>'variant_label', '')), ''),
        supplier_code = nullif(trim(coalesce(v_row->>'supplier_code', '')), ''),
        legacy_code = nullif(trim(coalesce(v_row->>'legacy_code', '')), ''),
        base_unit_id = (v_row->>'base_unit_id')::uuid,
        presentation_unit_id = nullif(v_row->>'presentation_unit_id', '')::uuid,
        units_per_presentation = nullif(v_row->>'units_per_presentation', '')::numeric,
        notes = nullif(trim(coalesce(v_row->>'notes', '')), '')
      where id = v_var.id returning * into v_var;
    end if;

    delete from public.variant_attribute_values where variant_id = v_var.id;
    for v_def in
      select a.id, a.name, a.data_type, a.options, pta.is_required,
        (select e from jsonb_array_elements(case when jsonb_typeof(v_row->'attributes') = 'array' then v_row->'attributes' else '[]'::jsonb end) e
          where e->>'attribute_id' = a.id::text limit 1) as val
      from public.product_type_attributes pta join public.attributes a on a.id = pta.attribute_id
      where pta.product_type_id = v_product.product_type_id
    loop
      v_attr := v_def.val;
      if v_attr is null then
        if v_def.is_required and v_target = 'registered' then
          raise exception '«%» es obligatorio en %: escribe el valor o márcalo como «Dato pendiente» o «No aplica».', v_def.name, v_label;
        end if;
        continue;
      end if;
      v_state := coalesce(v_attr->>'state', 'pending');
      if v_state not in ('value', 'not_applicable', 'pending') then raise exception 'Estado de atributo inválido'; end if;
      if v_state = 'value' then
        if v_def.data_type = 'number' then
          if nullif(v_attr->>'number', '') is null then raise exception 'Escribe un número en «%» (%)', v_def.name, v_label; end if;
          if (v_attr->>'number')::numeric < 0 then raise exception '«%» no puede ser negativo', v_def.name; end if;
        elsif v_def.data_type = 'multiselect' then
          if jsonb_typeof(v_attr->'options') is distinct from 'array' or jsonb_array_length(v_attr->'options') = 0 then
            raise exception 'Elige al menos una opción en «%» (%)', v_def.name, v_label;
          end if;
        else
          if length(trim(coalesce(v_attr->>'text', ''))) = 0 then raise exception 'Completa «%» (%)', v_def.name, v_label; end if;
          if v_def.data_type = 'select' and cardinality(v_def.options) > 0 and not (trim(v_attr->>'text') = any(v_def.options)) then
            raise exception 'Opción no válida en «%»', v_def.name;
          end if;
        end if;
      end if;
      insert into public.variant_attribute_values(variant_id, attribute_id, value_state, value_text, value_number, value_options, unit_id, updated_by)
      values (v_var.id, v_def.id, v_state::public.attribute_value_state,
        case when v_state = 'value' and v_def.data_type in ('text', 'select') then left(trim(v_attr->>'text'), 300) end,
        case when v_state = 'value' and v_def.data_type = 'number' then (v_attr->>'number')::numeric end,
        case when v_state = 'value' and v_def.data_type = 'multiselect' then
          array(select trim(o) from jsonb_array_elements_text(v_attr->'options') o where trim(o) <> '') end,
        case when v_state = 'value' and v_def.data_type = 'number' then nullif(v_attr->>'unit_id', '')::uuid end,
        v_uid);
    end loop;

    v_sig := public.variant_signature_from(v_product.product_type_id, public.variant_attrs_json(v_var.id));
    v_dup := null;
    if v_sig is not null then
      select coalesce(sku, 'un borrador sin SKU') into v_dup from public.variants
      where product_id = v_product.id and defining_signature = v_sig and id <> v_var.id and record_status <> 'archived' limit 1;
      if v_dup is not null then
        raise exception 'La combinación de % ya existe en este producto (%). Abre ese registro en lugar de duplicarlo.', v_label, v_dup;
      end if;
    end if;

    v_cnt := v_row->'count';
    update public.variants set defining_signature = v_sig,
      record_status = case when v_target = 'registered' then 'registered'::public.record_status else record_status end,
      draft_count = case when v_target = 'draft' and record_status = 'draft' then v_cnt else null end
    where id = v_var.id returning * into v_var;

    v_count := null;
    if v_was_draft and v_var.record_status = 'registered' and v_cnt is not null and jsonb_typeof(v_cnt) = 'object'
       and not coalesce((v_cnt->>'pending')::boolean, false) then
      if nullif(v_cnt->>'location_id', '') is null then raise exception 'Elige la ubicación de %', v_label; end if;
      v_count := public._record_initial_count(v_var.id, (v_cnt->>'location_id')::uuid,
        nullif(v_cnt->>'quantity', '')::numeric, nullif(v_cnt->>'full_presentations', '')::numeric,
        nullif(v_cnt->>'loose_quantity', '')::numeric, v_cnt->>'capture_ref', v_cnt->>'notes', v_var.idempotency_key);
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object('id', v_var.id, 'sku', v_var.sku,
      'record_status', v_var.record_status, 'variant_label', v_var.variant_label, 'reused', false, 'count', v_count));
  end loop;

  return jsonb_build_object('product_id', v_product.id, 'product_name', v_product.name, 'variants', v_results);
exception
  when unique_violation then
    if sqlerrm like '%variants_signature_uniq%' then
      raise exception 'Otra persona acaba de registrar esa misma combinación en este producto. Búscala antes de volver a guardar.';
    end if;
    raise;
end $$;

create or replace function public.check_variant_duplicates(_product_id uuid, _product_type_id uuid, _rows jsonb)
returns table(idx int, signature text, existing_id uuid, existing_sku text, existing_label text)
language sql stable set search_path = public as $$
  select (r.ord - 1)::int, s.sig, v.id, v.sku, v.variant_label
  from jsonb_array_elements(case when jsonb_typeof(_rows) = 'array' then _rows else '[]'::jsonb end) with ordinality r(val, ord)
  cross join lateral (select public.variant_signature_from(_product_type_id, r.val->'attributes') as sig) s
  left join lateral (
    select v.id, v.sku, v.variant_label from public.variants v
    where _product_id is not null and s.sig is not null and v.product_id = _product_id and v.defining_signature = s.sig
      and v.record_status <> 'archived' and v.id is distinct from nullif(r.val->>'id', '')::uuid
    limit 1
  ) v on true
$$;

create or replace function public.discard_draft(_variant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.variants; p public.products;
begin
  select * into v from public.variants where id = _variant_id for update;
  if v.id is null then raise exception 'El borrador ya no existe'; end if;
  if v.record_status <> 'draft' then raise exception 'Solo se pueden descartar borradores'; end if;
  if not (public.has_role(auth.uid(), 'admin') or (v.created_by = auth.uid() and public.is_staff(auth.uid()))) then
    raise exception 'Solo puedes descartar tus propios borradores';
  end if;
  delete from public.variants where id = v.id;
  select * into p from public.products where id = v.product_id;
  if p.id is not null and not exists (select 1 from public.variants where product_id = p.id)
     and (p.created_by = auth.uid() or public.has_role(auth.uid(), 'admin')) then
    delete from public.products where id = p.id;
  end if;
end $$;

create or replace function public.search_catalog(
  _q text default null, _category_id uuid default null, _unclassified boolean default false,
  _product_type_id uuid default null, _location_id uuid default null,
  _stock text default null, _photo text default null, _review text default null, _record text default null,
  _created_by uuid default null, _from date default null, _to date default null,
  _color text default null, _measure_attr uuid default null, _measure_value numeric default null,
  _cost_pending boolean default false, _sort text default 'recent', _limit int default 25, _offset int default 0)
returns table(id uuid, sku text, product_id uuid, product_name text, variant_label text, category_id uuid,
  product_type_name text, record_status public.record_status, review_status public.review_status,
  photo_status public.photo_status, unit_singular text, unit_plural text, allows_decimal boolean,
  total_quantity numeric, counted_locations int, location_names text, in_review_count int,
  primary_image text, supplier_code text, created_by uuid, created_by_name text, created_at timestamptz, total_count bigint)
language sql stable set search_path = public, extensions as $$
  with recursive
  cat_tree as (
    select c.id from public.categories c where c.id = _category_id
    union all select c.id from public.categories c join cat_tree t on c.parent_id = t.id
  ),
  loc_tree as (
    select l.id from public.locations l where l.id = _location_id
    union all select l.id from public.locations l join loc_tree t on l.parent_id = t.id
  ),
  tokens as (
    select tok from regexp_split_to_table(extensions.unaccent(lower(trim(coalesce(_q, '')))), '\s+') tok where tok <> ''
  ),
  base as (
    select v.id, v.sku, v.product_id, p.name as pname, v.variant_label, p.category_id, pt.name as ptname,
      v.record_status, v.review_status, v.photo_status, u.name_singular, u.name_plural, u.allows_decimal,
      st.total, st.n_loc, st.loc_names, v.supplier_code, v.created_by, v.created_at,
      (select count(*)::int from public.stock_counts sc where sc.variant_id = v.id and sc.status = 'in_review') as n_review,
      (select coalesce(i.thumbnail_path, i.storage_path) from public.variant_images i where i.variant_id = v.id
        order by i.is_primary desc, i.sort_order limit 1) as img
    from public.variants v
    join public.products p on p.id = v.product_id
    join public.units u on u.id = v.base_unit_id
    left join public.product_types pt on pt.id = p.product_type_id
    left join lateral (
      select sum(s.quantity) as total, count(*)::int as n_loc, string_agg(l.name, ', ' order by l.name) as loc_names
      from public.stock_levels s join public.locations l on l.id = s.location_id where s.variant_id = v.id
    ) st on true
    where (case when coalesce(_record, '') = '' then v.record_status <> 'archived' else v.record_status::text = _record end)
      and (_category_id is null or p.category_id in (select id from cat_tree))
      and (not coalesce(_unclassified, false) or p.category_id is null)
      and (_product_type_id is null or p.product_type_id = _product_type_id)
      and (coalesce(_review, '') = '' or v.review_status::text = _review)
      and (coalesce(_photo, '') = '' or (_photo = 'with') = (v.photo_status <> 'pending' or exists (select 1 from public.variant_images i where i.variant_id = v.id)))
      and (_created_by is null or v.created_by = _created_by)
      and (_from is null or v.created_at >= (_from::timestamp at time zone 'America/Mexico_City'))
      and (_to is null or v.created_at < ((_to + 1)::timestamp at time zone 'America/Mexico_City'))
      and (_location_id is null or exists (select 1 from public.stock_levels s where s.variant_id = v.id and s.location_id in (select id from loc_tree)))
      and (coalesce(_stock, '') = ''
        or (_stock = 'pending' and st.n_loc = 0)
        or (_stock = 'zero' and st.n_loc > 0 and st.total = 0)
        or (_stock = 'with' and st.total > 0))
      and (coalesce(trim(_color), '') = '' or exists (
        select 1 from public.variant_attribute_values av join public.attributes a on a.id = av.attribute_id
        where av.variant_id = v.id and a.code in ('color_principal', 'colores_secundarios') and av.value_state = 'value'
          and (extensions.unaccent(lower(coalesce(av.value_text, ''))) = extensions.unaccent(lower(trim(_color)))
            or extensions.unaccent(lower(trim(_color))) = any(array(select extensions.unaccent(lower(o)) from unnest(coalesce(av.value_options, '{}')) o)))))
      and (_measure_attr is null or _measure_value is null or exists (
        select 1 from public.variant_attribute_values av where av.variant_id = v.id and av.attribute_id = _measure_attr
          and av.value_state = 'value' and av.value_number = _measure_value))
      and (not coalesce(_cost_pending, false) or not public.has_role(auth.uid(), 'admin')
        or not exists (select 1 from public.variant_costs c where c.variant_id = v.id))
      and not exists (
        select 1 from tokens t where extensions.unaccent(lower(
          coalesce(v.sku, '') || ' ' || p.name || ' ' || coalesce(v.variant_label, '') || ' ' || coalesce(v.supplier_code, '') || ' ' ||
          coalesce(v.legacy_code, '') || ' ' || array_to_string(p.usage_tags, ' ') || ' ' || coalesce(st.loc_names, '') || ' ' ||
          coalesce(pt.name, '') || ' ' ||
          coalesce((select string_agg(coalesce(av.value_text, '') || ' ' || coalesce(array_to_string(av.value_options, ' '), '') || ' ' ||
            coalesce(trim_scale(av.value_number)::text, ''), ' ') from public.variant_attribute_values av where av.variant_id = v.id), '')
        )) not like '%' || t.tok || '%')
  )
  select b.id, b.sku, b.product_id, b.pname, b.variant_label, b.category_id, b.ptname, b.record_status, b.review_status,
    b.photo_status, b.name_singular, b.name_plural, b.allows_decimal, b.total, b.n_loc, b.loc_names, b.n_review, b.img,
    b.supplier_code, b.created_by, pr.full_name, b.created_at, count(*) over ()
  from base b left join public.profiles pr on pr.id = b.created_by
  order by
    case when _sort = 'sku' then b.sku end asc nulls last,
    case when _sort = 'name' then b.pname end asc,
    case when _sort = 'name' then b.variant_label end asc,
    case when _sort = 'quantity' then b.total end desc nulls last,
    b.created_at desc, b.id
  limit least(greatest(coalesce(_limit, 25), 1), 100)
  offset greatest(coalesce(_offset, 0), 0)
$$;

grant execute on function public.record_count(jsonb) to authenticated;
grant execute on function public.review_count(uuid, boolean, text) to authenticated;
grant execute on function public.save_capture(jsonb) to authenticated;
grant execute on function public.check_variant_duplicates(uuid, uuid, jsonb) to authenticated;
grant execute on function public.discard_draft(uuid) to authenticated;
grant execute on function public.search_catalog(text, uuid, boolean, uuid, uuid, text, text, text, text, uuid, date, date, text, uuid, numeric, boolean, text, int, int) to authenticated;
