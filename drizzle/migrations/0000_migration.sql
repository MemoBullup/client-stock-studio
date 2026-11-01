
-- =========================================================
-- BLOQUE A · Modelo de datos, roles, permisos y catálogos
-- =========================================================
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------- Tipos ----------
create type public.app_role as enum ('admin','editor');
create type public.record_status as enum ('draft','registered','archived');
create type public.review_status as enum ('pending','validated');
create type public.photo_status as enum ('pending','uploaded','approved');
create type public.attribute_data_type as enum ('text','number','select','multiselect');
create type public.attribute_value_state as enum ('value','not_applicable','pending');
create type public.unit_kind as enum ('inventory','measure');
create type public.count_entry_status as enum ('confirmed','in_review','rejected');
create type public.ecommerce_status as enum ('not_ready','in_preparation','ready');
create type public.request_status as enum ('open','resolved','rejected');

-- ---------- Perfiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 120),
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ---------- Roles (un rol por usuario) ----------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  unique (user_id)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and r.role = _role and p.is_active
  )
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = _user_id and p.is_active
  )
$$;

create policy "Perfil propio o personal autorizado" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff(auth.uid()));
create policy "Actualizar nombre propio" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "Ver rol propio o todos si es admin" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- Perfil automático al crear cuenta (sin rol: queda pendiente de autorización)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Configuración del negocio ----------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'Aly' check (length(business_name) between 1 and 80),
  business_tagline text default 'Creaciones con estilo' check (length(business_tagline) <= 120),
  logo_path text,
  contact_info text check (length(contact_info) <= 500),
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'es-MX',
  sku_prefix text not null default 'ALY-' check (sku_prefix ~ '^[A-Z0-9-]{1,10}$'),
  sku_digits int not null default 6 check (sku_digits between 4 and 10),
  qr_base_url text check (qr_base_url is null or qr_base_url ~ '^https?://'),
  sku_goal int not null default 5000 check (sku_goal > 0),
  max_category_depth int not null default 4 check (max_category_depth between 1 and 8),
  label_width_mm numeric not null default 50 check (label_width_mm between 15 and 200),
  label_height_mm numeric not null default 30 check (label_height_mm between 10 and 200),
  is_demo_environment boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
grant select, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "Personal ve configuración" on public.app_settings
  for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin modifica configuración" on public.app_settings
  for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
insert into public.app_settings (id) values (1);

-- Marca visible en la pantalla de acceso (sin datos sensibles)
create or replace function public.get_public_branding()
returns table (business_name text, business_tagline text, logo_path text)
language sql stable security definer set search_path = public as $$
  select business_name, business_tagline, logo_path from public.app_settings where id = 1
$$;
grant execute on function public.get_public_branding() to anon, authenticated;

-- ---------- SKU: secuencia única, nunca se reutiliza ----------
create sequence public.sku_seq start 1 no cycle;

-- ---------- Árboles (categorías / ubicaciones) ----------
create or replace function public.tree_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_parent_depth int := 0;
  v_cursor uuid;
  v_steps int := 0;
  v_subtree int := 0;
begin
  if TG_TABLE_NAME = 'categories' then
    select max_category_depth into v_max from public.app_settings where id = 1;
  else
    v_max := 8;
  end if;
  if NEW.parent_id is not null then
    if NEW.parent_id = NEW.id then
      raise exception 'Un elemento no puede ser su propio padre';
    end if;
    v_cursor := NEW.parent_id;
    while v_cursor is not null loop
      if v_cursor = NEW.id then
        raise exception 'Movimiento inválido: generaría un ciclo en el árbol';
      end if;
      execute format('select parent_id from public.%I where id = $1', TG_TABLE_NAME) into v_cursor using v_cursor;
      v_steps := v_steps + 1;
      exit when v_steps > 64;
    end loop;
    execute format('select depth from public.%I where id = $1', TG_TABLE_NAME) into v_parent_depth using NEW.parent_id;
  end if;
  NEW.depth := coalesce(v_parent_depth, 0) + 1;
  if TG_OP = 'UPDATE' then
    execute format(
      'with recursive t as (select id, 1 as lvl from public.%I where parent_id = $1
         union all select c.id, t.lvl + 1 from public.%I c join t on c.parent_id = t.id where t.lvl < 64)
       select coalesce(max(lvl), 0) from t', TG_TABLE_NAME, TG_TABLE_NAME)
    into v_subtree using NEW.id;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  else
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  end if;
  if NEW.depth + v_subtree > v_max then
    raise exception 'Se permite un máximo de % niveles', v_max;
  end if;
  return NEW;
end $$;

create or replace function public.tree_cascade_depth()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.depth is distinct from OLD.depth then
    execute format('update public.%I set depth = depth where parent_id = $1', TG_TABLE_NAME) using NEW.id;
  end if;
  return null;
end $$;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  description text check (length(description) <= 300),
  sort_order int not null default 0,
  is_active boolean not null default true,
  depth smallint not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index categories_unique_name on public.categories
  (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index categories_parent_idx on public.categories(parent_id);
grant select, insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;
create policy "Personal ve categorías" on public.categories for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin crea categorías" on public.categories for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "Admin edita categorías" on public.categories for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "Admin elimina categorías" on public.categories for delete to authenticated using (public.has_role(auth.uid(),'admin'));
create trigger categories_guard before insert or update on public.categories for each row execute function public.tree_guard();
create trigger categories_cascade after update of depth on public.categories for each row execute function public.tree_cascade_depth();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.locations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  code text check (length(code) <= 30),
  description text check (length(description) <= 300),
  sort_order int not null default 0,
  is_active boolean not null default true,
  depth smallint not null default 1,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index locations_unique_name on public.locations
  (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index locations_parent_idx on public.locations(parent_id);
grant select, insert, update, delete on public.locations to authenticated;
grant all on public.locations to service_role;
alter table public.locations enable row level security;
create policy "Personal ve ubicaciones" on public.locations for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin crea ubicaciones" on public.locations for insert to authenticated with check (public.has_role(auth.uid(),'admin'));
create policy "Admin edita ubicaciones" on public.locations for update to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "Admin elimina ubicaciones" on public.locations for delete to authenticated using (public.has_role(auth.uid(),'admin'));
create trigger locations_guard before insert or update on public.locations for each row execute function public.tree_guard();
create trigger locations_cascade after update of depth on public.locations for each row execute function public.tree_cascade_depth();

-- ---------- Unidades ----------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{1,20}$'),
  name_singular text not null,
  name_plural text not null,
  symbol text,
  kind public.unit_kind not null,
  allows_decimal boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.units to authenticated;
grant all on public.units to service_role;
alter table public.units enable row level security;
create policy "Personal ve unidades" on public.units for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin gestiona unidades" on public.units for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ---------- Tipos de producto y atributos ----------
create table public.product_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  description text,
  default_unit_id uuid references public.units(id) on delete set null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.product_types to authenticated;
grant all on public.product_types to service_role;
alter table public.product_types enable row level security;
create policy "Personal ve tipos" on public.product_types for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin gestiona tipos" on public.product_types for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.attributes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (length(trim(name)) between 1 and 80),
  data_type public.attribute_data_type not null,
  options text[] not null default '{}',
  default_unit_id uuid references public.units(id) on delete set null,
  help_text text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.attributes to authenticated;
grant all on public.attributes to service_role;
alter table public.attributes enable row level security;
create policy "Personal ve atributos" on public.attributes for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin gestiona atributos" on public.attributes for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.product_type_attributes (
  product_type_id uuid not null references public.product_types(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  is_required boolean not null default false,
  is_variant_defining boolean not null default false,
  sort_order int not null default 0,
  primary key (product_type_id, attribute_id)
);
grant select, insert, update, delete on public.product_type_attributes to authenticated;
grant all on public.product_type_attributes to service_role;
alter table public.product_type_attributes enable row level security;
create policy "Personal ve atributos por tipo" on public.product_type_attributes for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin gestiona atributos por tipo" on public.product_type_attributes for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ---------- Productos (modelo) ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  product_type_id uuid references public.product_types(id) on delete restrict,
  category_id uuid references public.categories(id) on delete restrict, -- null = Por clasificar
  description text check (length(description) <= 1000),
  usage_tags text[] not null default '{}',
  notes text check (length(notes) <= 2000),
  is_archived boolean not null default false,
  commercial_name text,
  commercial_description text,
  slug text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ecommerce_status public.ecommerce_status not null default 'not_ready',
  is_published boolean not null default false,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);
create index products_type_idx on public.products(product_type_id);
grant select, insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
alter table public.products enable row level security;

-- ---------- Variantes (SKU) ----------
create table public.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  sku text unique,
  variant_label text check (length(variant_label) <= 160),
  supplier_code text check (length(supplier_code) <= 60),
  legacy_code text check (length(legacy_code) <= 60),
  base_unit_id uuid not null references public.units(id) on delete restrict,
  presentation_unit_id uuid references public.units(id) on delete restrict,
  units_per_presentation numeric check (units_per_presentation is null or units_per_presentation > 0),
  record_status public.record_status not null default 'draft',
  review_status public.review_status not null default 'pending',
  photo_status public.photo_status not null default 'pending',
  notes text check (length(notes) <= 2000),
  defining_signature text,
  idempotency_key uuid unique,
  version int not null default 1,
  is_demo boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  archived_by uuid,
  archived_at timestamptz
);
create index variants_product_idx on public.variants(product_id);
create index variants_status_idx on public.variants(record_status, review_status, photo_status);
create index variants_created_idx on public.variants(created_by, created_at);
create unique index variants_signature_uniq on public.variants(product_id, defining_signature)
  where defining_signature is not null and record_status <> 'archived';
grant select, insert, update, delete on public.variants to authenticated;
grant all on public.variants to service_role;
alter table public.variants enable row level security;

create or replace function public.generate_sku()
returns text language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_digits int; v_n bigint; v_sku text;
begin
  select sku_prefix, sku_digits into v_prefix, v_digits from public.app_settings where id = 1;
  loop
    v_n := nextval('public.sku_seq');
    v_sku := v_prefix || case when length(v_n::text) >= v_digits then v_n::text else lpad(v_n::text, v_digits, '0') end;
    exit when not exists (select 1 from public.variants where sku = v_sku);
  end loop;
  return v_sku;
end $$;

create policy "Personal ve productos" on public.products for select to authenticated using (public.is_staff(auth.uid()));
create policy "Personal crea productos" on public.products for insert to authenticated
  with check (public.is_staff(auth.uid()) and created_by = auth.uid() and is_archived = false and is_published = false);
create policy "Admin o autor sin confirmar edita producto" on public.products for update to authenticated
  using (public.has_role(auth.uid(),'admin') or (created_by = auth.uid() and public.is_staff(auth.uid())
    and not exists (select 1 from public.variants v where v.product_id = products.id and v.record_status <> 'draft')))
  with check (public.has_role(auth.uid(),'admin') or (created_by = auth.uid() and is_archived = false and is_published = false));
create policy "Admin elimina productos" on public.products for delete to authenticated using (public.has_role(auth.uid(),'admin'));

create policy "Personal ve variantes confirmadas o borradores propios" on public.variants for select to authenticated
  using (public.is_staff(auth.uid()) and (record_status <> 'draft' or created_by = auth.uid() or public.has_role(auth.uid(),'admin')));
create policy "Personal crea variantes" on public.variants for insert to authenticated
  with check (public.is_staff(auth.uid()) and created_by = auth.uid());
create policy "Admin o borrador propio edita variante" on public.variants for update to authenticated
  using (public.has_role(auth.uid(),'admin') or (public.is_staff(auth.uid()) and created_by = auth.uid() and record_status = 'draft'))
  with check (public.has_role(auth.uid(),'admin') or (created_by = auth.uid() and record_status in ('draft','registered')));
create policy "Admin o borrador propio elimina variante" on public.variants for delete to authenticated
  using (public.has_role(auth.uid(),'admin') or (public.is_staff(auth.uid()) and created_by = auth.uid() and record_status = 'draft'));

create or replace function public.products_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  else
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  end if;
  return NEW;
end $$;
create trigger products_before_write before insert or update on public.products
  for each row execute function public.products_before_write();

create or replace function public.variants_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_admin boolean := auth.uid() is null or public.has_role(auth.uid(),'admin');
begin
  if TG_OP = 'INSERT' then
    NEW.sku := null; -- el SKU solo lo genera el servidor
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
create trigger variants_before_write before insert or update on public.variants
  for each row execute function public.variants_before_write();

-- ---------- Valores de atributos ----------
create table public.variant_attribute_values (
  variant_id uuid not null references public.variants(id) on delete cascade,
  attribute_id uuid not null references public.attributes(id) on delete restrict,
  value_state public.attribute_value_state not null default 'pending',
  value_text text check (length(value_text) <= 300),
  value_number numeric,
  value_options text[],
  unit_id uuid references public.units(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (variant_id, attribute_id),
  check (value_state <> 'value' or value_text is not null or value_number is not null or (value_options is not null and cardinality(value_options) > 0))
);
grant select, insert, update, delete on public.variant_attribute_values to authenticated;
grant all on public.variant_attribute_values to service_role;
alter table public.variant_attribute_values enable row level security;
create policy "Personal ve atributos de variantes visibles" on public.variant_attribute_values for select to authenticated
  using (exists (select 1 from public.variants v where v.id = variant_id));
create policy "Admin o borrador propio escribe atributos" on public.variant_attribute_values for all to authenticated
  using (exists (select 1 from public.variants v where v.id = variant_id and (public.has_role(auth.uid(),'admin') or (v.created_by = auth.uid() and v.record_status = 'draft'))))
  with check (exists (select 1 from public.variants v where v.id = variant_id and (public.has_role(auth.uid(),'admin') or (v.created_by = auth.uid() and v.record_status = 'draft'))));

-- ---------- Sesiones de levantamiento, conteos y existencias ----------
create table public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_open boolean not null default true,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid
);
grant select, insert, update, delete on public.inventory_sessions to authenticated;
grant all on public.inventory_sessions to service_role;
alter table public.inventory_sessions enable row level security;
create policy "Personal ve sesiones" on public.inventory_sessions for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin gestiona sesiones" on public.inventory_sessions for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  session_id uuid not null references public.inventory_sessions(id) on delete restrict,
  quantity numeric not null check (quantity >= 0),
  full_presentations numeric check (full_presentations is null or full_presentations >= 0),
  loose_quantity numeric check (loose_quantity is null or loose_quantity >= 0),
  conversion_factor numeric check (conversion_factor is null or conversion_factor > 0),
  status public.count_entry_status not null default 'confirmed',
  capture_ref text,
  notes text check (length(notes) <= 1000),
  idempotency_key uuid unique,
  counted_by uuid,
  counted_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  is_demo boolean not null default false
);
create unique index stock_counts_one_confirmed on public.stock_counts(variant_id, location_id, session_id) where status = 'confirmed';
create index stock_counts_variant_idx on public.stock_counts(variant_id);
grant select on public.stock_counts to authenticated;
grant all on public.stock_counts to service_role;
alter table public.stock_counts enable row level security;
create policy "Personal ve conteos" on public.stock_counts for select to authenticated using (public.is_staff(auth.uid()));

create table public.stock_levels (
  variant_id uuid not null references public.variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity numeric not null check (quantity >= 0),
  counted_at timestamptz not null default now(),
  counted_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  is_demo boolean not null default false,
  primary key (variant_id, location_id)
);
create index stock_levels_location_idx on public.stock_levels(location_id);
grant select on public.stock_levels to authenticated;
grant all on public.stock_levels to service_role;
alter table public.stock_levels enable row level security;
create policy "Personal ve existencias" on public.stock_levels for select to authenticated using (public.is_staff(auth.uid()));

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  previous_quantity numeric not null,
  new_quantity numeric not null check (new_quantity >= 0),
  reason text not null check (length(trim(reason)) between 3 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  is_demo boolean not null default false
);
grant select on public.stock_adjustments to authenticated;
grant all on public.stock_adjustments to service_role;
alter table public.stock_adjustments enable row level security;
create policy "Admin ve ajustes" on public.stock_adjustments for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.validate_quantity_unit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dec boolean;
begin
  select u.allows_decimal into v_dec from public.variants v join public.units u on u.id = v.base_unit_id where v.id = NEW.variant_id;
  if not coalesce(v_dec, false) and NEW.quantity <> trunc(NEW.quantity) then
    raise exception 'Esta unidad solo admite cantidades enteras';
  end if;
  return NEW;
end $$;
create trigger stock_counts_unit before insert or update on public.stock_counts for each row execute function public.validate_quantity_unit();
create trigger stock_levels_unit before insert or update on public.stock_levels for each row execute function public.validate_quantity_unit();

-- ---------- Costos privados (solo Administrador) ----------
create table public.variant_costs (
  variant_id uuid primary key references public.variants(id) on delete cascade,
  cost_per_base_unit numeric not null check (cost_per_base_unit >= 0),
  currency text not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  is_demo boolean not null default false
);
grant select, insert, update, delete on public.variant_costs to authenticated;
grant all on public.variant_costs to service_role;
alter table public.variant_costs enable row level security;
create policy "Solo admin accede a costos" on public.variant_costs for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create table public.cost_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  previous_cost numeric,
  new_cost numeric,
  currency text not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
grant select on public.cost_history to authenticated;
grant all on public.cost_history to service_role;
alter table public.cost_history enable row level security;
create policy "Solo admin ve historial de costos" on public.cost_history for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.track_cost_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    insert into public.cost_history(variant_id, previous_cost, new_cost, currency, changed_by)
    values (OLD.variant_id, OLD.cost_per_base_unit, null, OLD.currency, auth.uid());
    return OLD;
  end if;
  if TG_OP = 'INSERT' or NEW.cost_per_base_unit is distinct from OLD.cost_per_base_unit or NEW.currency is distinct from OLD.currency then
    insert into public.cost_history(variant_id, previous_cost, new_cost, currency, changed_by)
    values (NEW.variant_id, case when TG_OP = 'UPDATE' then OLD.cost_per_base_unit end, NEW.cost_per_base_unit, NEW.currency, auth.uid());
  end if;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  return NEW;
end $$;
create trigger variant_costs_track before insert or update on public.variant_costs for each row execute function public.track_cost_change();
create trigger variant_costs_track_del after delete on public.variant_costs for each row execute function public.track_cost_change();

-- ---------- Imágenes ----------
create table public.variant_images (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  storage_path text not null,
  thumbnail_path text,
  alt_text text check (length(alt_text) <= 300),
  is_primary boolean not null default false,
  sort_order int not null default 0,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create unique index variant_images_one_primary on public.variant_images(variant_id) where is_primary;
grant select, insert, update, delete on public.variant_images to authenticated;
grant all on public.variant_images to service_role;
alter table public.variant_images enable row level security;
create policy "Personal ve imágenes de variantes visibles" on public.variant_images for select to authenticated
  using (exists (select 1 from public.variants v where v.id = variant_id));
create policy "Admin o borrador propio gestiona imágenes" on public.variant_images for all to authenticated
  using (exists (select 1 from public.variants v where v.id = variant_id and (public.has_role(auth.uid(),'admin') or (v.created_by = auth.uid() and v.record_status = 'draft'))))
  with check (exists (select 1 from public.variants v where v.id = variant_id and (public.has_role(auth.uid(),'admin') or (v.created_by = auth.uid() and v.record_status = 'draft'))));

-- ---------- Solicitudes de corrección ----------
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.variants(id) on delete cascade,
  requested_by uuid not null default auth.uid(),
  message text not null check (length(trim(message)) between 3 and 1000),
  status public.request_status not null default 'open',
  resolution_note text check (length(resolution_note) <= 1000),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.correction_requests to authenticated;
grant all on public.correction_requests to service_role;
alter table public.correction_requests enable row level security;
create policy "Ver solicitudes propias o todas si es admin" on public.correction_requests for select to authenticated
  using (requested_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy "Personal crea solicitudes" on public.correction_requests for insert to authenticated
  with check (public.is_staff(auth.uid()) and requested_by = auth.uid() and status = 'open');
create policy "Admin resuelve solicitudes" on public.correction_requests for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- ---------- Historial de cambios (no incluye costos) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text,
  action text not null,
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log(table_name, record_id);
create index audit_log_created_idx on public.audit_log(created_at desc);
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;
create policy "Solo admin ve historial" on public.audit_log for select to authenticated using (public.has_role(auth.uid(),'admin'));

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  insert into public.audit_log(table_name, record_id, action, actor_id, old_data, new_data)
  values (TG_TABLE_NAME, coalesce(v_row->>'id', v_row->>'variant_id', v_row->>'user_id'), TG_OP, auth.uid(),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) end);
  return null;
end $$;

-- ---------- Funciones administrativas ----------
create or replace function public.set_user_role(_user_id uuid, _role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede asignar roles'; end if;
  if _role is distinct from 'admin' and exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
     and (select count(*) from public.user_roles r join public.profiles p on p.id = r.user_id where r.role = 'admin' and p.is_active) <= 1 then
    raise exception 'Debe existir al menos un Administrador activo';
  end if;
  if _role is null then
    delete from public.user_roles where user_id = _user_id;
  else
    insert into public.user_roles(user_id, role, assigned_by) values (_user_id, _role, auth.uid())
    on conflict (user_id) do update set role = excluded.role, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;
end $$;
revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;

create or replace function public.set_user_active(_user_id uuid, _active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede cambiar el acceso'; end if;
  if _user_id = auth.uid() and not _active then raise exception 'No puedes desactivar tu propia cuenta'; end if;
  if not _active and exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin')
     and (select count(*) from public.user_roles r join public.profiles p on p.id = r.user_id where r.role = 'admin' and p.is_active) <= 1 then
    raise exception 'Debe existir al menos un Administrador activo';
  end if;
  update public.profiles set is_active = _active, updated_at = now() where id = _user_id;
end $$;
revoke execute on function public.set_user_active(uuid, boolean) from public, anon;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;

create or replace function public.delete_category(_id uuid, _reassign boolean default false, _reassign_to uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede eliminar categorías'; end if;
  if exists (select 1 from public.categories where parent_id = _id) then
    raise exception 'Primero mueve o elimina sus subcategorías';
  end if;
  select count(*) into v_count from public.products where category_id = _id;
  if v_count > 0 then
    if not _reassign then
      raise exception 'La categoría tiene % producto(s). Elige a dónde reasignarlos antes de eliminarla.', v_count;
    end if;
    if _reassign_to = _id then raise exception 'Elige una categoría distinta'; end if;
    update public.products set category_id = _reassign_to where category_id = _id;
  end if;
  delete from public.categories where id = _id;
end $$;
revoke execute on function public.delete_category(uuid, boolean, uuid) from public, anon;
grant execute on function public.delete_category(uuid, boolean, uuid) to authenticated;

create or replace function public.delete_location(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Solo un Administrador puede eliminar ubicaciones'; end if;
  if exists (select 1 from public.locations where parent_id = _id) then
    raise exception 'Primero mueve o elimina las ubicaciones que contiene';
  end if;
  if exists (select 1 from public.stock_levels where location_id = _id) or exists (select 1 from public.stock_counts where location_id = _id) then
    raise exception 'La ubicación tiene existencias o conteos registrados. Desactívala en lugar de eliminarla.';
  end if;
  delete from public.locations where id = _id;
end $$;
revoke execute on function public.delete_location(uuid) from public, anon;
grant execute on function public.delete_location(uuid) to authenticated;

create or replace function public.category_product_counts()
returns table (category_id uuid, product_count bigint)
language sql stable security definer set search_path = public as $$
  select p.category_id, count(*) from public.products p
  where public.is_staff(auth.uid()) and p.category_id is not null
  group by p.category_id
$$;
revoke execute on function public.category_product_counts() from public, anon;
grant execute on function public.category_product_counts() to authenticated;

create or replace function public.location_stock_counts()
returns table (location_id uuid, sku_count bigint)
language sql stable security definer set search_path = public as $$
  select s.location_id, count(distinct s.variant_id) from public.stock_levels s
  where public.is_staff(auth.uid())
  group by s.location_id
$$;
revoke execute on function public.location_stock_counts() from public, anon;
grant execute on function public.location_stock_counts() to authenticated;

-- Primer Administrador: solo ejecutable por el equipo técnico desde la base de datos
create or replace function public.bootstrap_first_admin(_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'Ya existe un Administrador. Asigna roles desde la aplicación.';
  end if;
  select id into v_id from auth.users where lower(email) = lower(_email);
  if v_id is null then raise exception 'No existe una cuenta con ese correo'; end if;
  insert into public.profiles(id, email) values (v_id, _email) on conflict (id) do update set is_active = true;
  insert into public.user_roles(user_id, role) values (v_id, 'admin') on conflict (user_id) do update set role = 'admin';
end $$;
revoke execute on function public.bootstrap_first_admin(text) from public, anon, authenticated;
revoke execute on function public.generate_sku() from public, anon, authenticated;

-- =========================================================
-- Datos base
-- =========================================================
insert into public.units (code, name_singular, name_plural, symbol, kind, allows_decimal, sort_order) values
  ('pieza','pieza','piezas','pza','inventory', false, 1),
  ('metro','metro','metros','m','inventory', true, 2),
  ('rollo','rollo','rollos','rollo','inventory', false, 3),
  ('paquete','paquete','paquetes','paq','inventory', false, 4),
  ('docena','docena','docenas','doc','inventory', false, 5),
  ('mm','milímetro','milímetros','mm','measure', true, 10),
  ('cm','centímetro','centímetros','cm','measure', true, 11),
  ('m_medida','metro','metros','m','measure', true, 12),
  ('pulgada','pulgada','pulgadas','in','measure', true, 13);

insert into public.attributes (code, name, data_type, options, default_unit_id, sort_order) values
  ('diseno','Diseño o modelo','text','{}', null, 1),
  ('color_principal','Color principal','select','{Blanco,Negro,Rojo,Rosa,Fucsia,Morado,Lila,Azul,Azul marino,Azul cielo,Turquesa,Verde,Verde menta,Amarillo,Naranja,Café,Beige,Dorado,Plateado,Multicolor,Arcoíris,Transparente}', null, 2),
  ('colores_secundarios','Colores secundarios','multiselect','{Blanco,Negro,Rojo,Rosa,Fucsia,Morado,Lila,Azul,Azul marino,Azul cielo,Turquesa,Verde,Verde menta,Amarillo,Naranja,Café,Beige,Dorado,Plateado}', null, 3),
  ('material','Material','select','{Satín,Grosgrain,Organza,Terciopelo,Yute,Algodón,Poliéster,Glitter,Foamy,Acrílico,Resina,Metal,PVC,Papel,Vinil,Otro}', null, 4),
  ('acabado','Acabado','select','{Mate,Brillante,Glitter,Lentejuela,Metálico,Holográfico,Satinado,Otro}', null, 5),
  ('ancho','Ancho','number','{}', (select id from public.units where code='mm'), 6),
  ('alto','Alto','number','{}', (select id from public.units where code='mm'), 7),
  ('largo','Largo','number','{}', (select id from public.units where code='cm'), 8),
  ('diametro','Diámetro','number','{}', (select id from public.units where code='mm'), 9),
  ('grosor','Grosor','number','{}', (select id from public.units where code='mm'), 10),
  ('forma','Forma','select','{Redonda,Corazón,Estrella,Moño,Flor,Mariposa,Letra,Número,Figura,Otra}', null, 11),
  ('formato','Formato','select','{Calcomanía,Etiqueta,Tarjeta,Topper,Recorte,Otro}', null, 12),
  ('presentacion','Presentación','select','{Pieza,Rollo,Paquete,Metro,Docena}', null, 13),
  ('contenido_presentacion','Contenido por presentación','number','{}', null, 14);

insert into public.product_types (name, description, default_unit_id, sort_order) values
  ('Listón','Listones por metro o por rollo', (select id from public.units where code='metro'), 1),
  ('Aplicación decorativa','Figuras y apliques decorativos', (select id from public.units where code='pieza'), 2),
  ('Dije','Dijes y miniaturas', (select id from public.units where code='pieza'), 3),
  ('Producto impreso','Calcomanías, toppers y etiquetas impresas', (select id from public.units where code='pieza'), 4);

insert into public.product_type_attributes (product_type_id, attribute_id, is_required, is_variant_defining, sort_order)
select t.id, a.id, x.req, x.def, x.ord
from (values
  ('Listón','diseno', true, false, 1), ('Listón','ancho', true, true, 2), ('Listón','material', false, true, 3),
  ('Listón','acabado', false, true, 4), ('Listón','color_principal', true, true, 5), ('Listón','colores_secundarios', false, false, 6),
  ('Listón','presentacion', false, false, 7), ('Listón','contenido_presentacion', false, false, 8),
  ('Aplicación decorativa','diseno', true, false, 1), ('Aplicación decorativa','alto', false, true, 2), ('Aplicación decorativa','ancho', false, true, 3),
  ('Aplicación decorativa','material', false, true, 4), ('Aplicación decorativa','acabado', false, true, 5), ('Aplicación decorativa','color_principal', false, true, 6),
  ('Dije','forma', true, true, 1), ('Dije','color_principal', true, true, 2), ('Dije','acabado', false, true, 3),
  ('Dije','alto', false, false, 4), ('Dije','ancho', false, false, 5), ('Dije','material', false, false, 6),
  ('Producto impreso','formato', true, true, 1), ('Producto impreso','alto', false, true, 2), ('Producto impreso','ancho', false, true, 3),
  ('Producto impreso','material', false, true, 4), ('Producto impreso','diseno', true, true, 5)
) as x(tname, acode, req, def, ord)
join public.product_types t on t.name = x.tname
join public.attributes a on a.code = x.acode;

-- Categorías y ubicaciones demostrativas (reemplazables por las reales)
do $$
declare
  r1 uuid; r2 uuid; r3 uuid;
begin
  insert into public.categories(name, sort_order, is_demo) values ('Listones', 1, true) returning id into r1;
    insert into public.categories(parent_id, name, sort_order, is_demo) values (r1, 'Textiles', 1, true) returning id into r2;
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Estampados', 1, true) returning id into r3;
        insert into public.categories(parent_id, name, sort_order, is_demo) values (r3, 'Escolares', 1, true);
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Lisos', 2, true);
    insert into public.categories(parent_id, name, sort_order, is_demo) values (r1, 'Decorativos', 2, true) returning id into r2;
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Lentejuelas', 1, true) returning id into r3;
        insert into public.categories(parent_id, name, sort_order, is_demo) values (r3, 'Reversibles', 1, true);
  insert into public.categories(name, sort_order, is_demo) values ('Aplicaciones', 2, true) returning id into r1;
    insert into public.categories(parent_id, name, sort_order, is_demo) values (r1, 'Figuras decorativas', 1, true) returning id into r2;
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Temáticas', 1, true) returning id into r3;
        insert into public.categories(parent_id, name, sort_order, is_demo) values (r3, 'Navidad', 1, true);
  insert into public.categories(name, sort_order, is_demo) values ('Accesorios', 3, true) returning id into r1;
    insert into public.categories(parent_id, name, sort_order, is_demo) values (r1, 'Dijes', 1, true) returning id into r2;
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Miniaturas', 1, true) returning id into r3;
        insert into public.categories(parent_id, name, sort_order, is_demo) values (r3, 'Audífonos', 1, true);
  insert into public.categories(name, sort_order, is_demo) values ('Productos impresos', 4, true) returning id into r1;
    insert into public.categories(parent_id, name, sort_order, is_demo) values (r1, 'Aplicaciones', 1, true) returning id into r2;
      insert into public.categories(parent_id, name, sort_order, is_demo) values (r2, 'Temáticos', 1, true) returning id into r3;
        insert into public.categories(parent_id, name, sort_order, is_demo) values (r3, 'Regionales', 1, true);

  insert into public.locations(name, code, sort_order, is_demo) values ('Bodega', 'BOD', 1, true) returning id into r1;
    insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r1, 'Pasillo A', 'A', 1, true) returning id into r2;
      insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r2, 'Estante 03', 'E03', 1, true) returning id into r3;
        insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r3, 'Caja 01', 'C01', 1, true);
        insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r3, 'Caja 02', 'C02', 2, true);
    insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r1, 'Pasillo B', 'B', 2, true) returning id into r2;
      insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r2, 'Estante 01', 'E01', 1, true);
  insert into public.locations(name, code, sort_order, is_demo) values ('Tienda', 'TDA', 2, true) returning id into r1;
    insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r1, 'Mostrador', 'MOS', 1, true);
    insert into public.locations(parent_id, name, code, sort_order, is_demo) values (r1, 'Exhibidor', 'EXH', 2, true);

  insert into public.inventory_sessions(name, is_demo) values ('Levantamiento inicial', false);
end $$;

-- Historial: se activa después de cargar los datos base
create trigger audit_products after insert or update or delete on public.products for each row execute function public.audit_trigger();
create trigger audit_variants after insert or update or delete on public.variants for each row execute function public.audit_trigger();
create trigger audit_variant_attrs after insert or update or delete on public.variant_attribute_values for each row execute function public.audit_trigger();
create trigger audit_categories after insert or update or delete on public.categories for each row execute function public.audit_trigger();
create trigger audit_locations after insert or update or delete on public.locations for each row execute function public.audit_trigger();
create trigger audit_product_types after insert or update or delete on public.product_types for each row execute function public.audit_trigger();
create trigger audit_attributes after insert or update or delete on public.attributes for each row execute function public.audit_trigger();
create trigger audit_units after insert or update or delete on public.units for each row execute function public.audit_trigger();
create trigger audit_stock_levels after insert or update or delete on public.stock_levels for each row execute function public.audit_trigger();
create trigger audit_stock_counts after insert or update or delete on public.stock_counts for each row execute function public.audit_trigger();
create trigger audit_user_roles after insert or update or delete on public.user_roles for each row execute function public.audit_trigger();
create trigger audit_settings after update on public.app_settings for each row execute function public.audit_trigger();
create trigger audit_corrections after insert or update on public.correction_requests for each row execute function public.audit_trigger();

-- ---------- Almacenamiento privado: logotipo del negocio ----------
create policy "Logo legible para firmar URL" on storage.objects for select to anon, authenticated using (bucket_id = 'branding');
create policy "Admin sube logo" on storage.objects for insert to authenticated with check (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));
create policy "Admin actualiza logo" on storage.objects for update to authenticated using (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));
create policy "Admin borra logo" on storage.objects for delete to authenticated using (bucket_id = 'branding' and public.has_role(auth.uid(),'admin'));
