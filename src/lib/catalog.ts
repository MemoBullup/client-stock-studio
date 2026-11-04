// Consultas compartidas de catálogo (tipos, atributos, unidades, árboles).
// Todas pasan por los permisos de la base de datos; ninguna toca costos.
import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AttrDef, UnitLite } from "@/lib/capture";
import type { TreeItem } from "@/lib/tree";

export type RecordStatus = Database["public"]["Enums"]["record_status"];
export type ReviewStatus = Database["public"]["Enums"]["review_status"];
export type PhotoStatus = Database["public"]["Enums"]["photo_status"];
type SearchArgs = Database["public"]["Functions"]["search_catalog"]["Args"];
export type CatalogRow = Database["public"]["Functions"]["search_catalog"]["Returns"][number];

export const RECORD_LABEL: Record<RecordStatus, string> = {
  draft: "Borrador",
  registered: "Registrado",
  archived: "Archivado",
};
export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: "Revisión pendiente",
  validated: "Validado",
};
export const PHOTO_LABEL: Record<PhotoStatus, string> = {
  pending: "Foto pendiente",
  uploaded: "Foto cargada",
  approved: "Foto aprobada",
};

export interface ProductTypeFull {
  id: string;
  name: string;
  default_unit_id: string | null;
  attributes: AttrDef[];
}

export const productTypesQuery = queryOptions({
  queryKey: ["catalog", "product-types"],
  queryFn: async (): Promise<ProductTypeFull[]> => {
    const [types, links] = await Promise.all([
      supabase
        .from("product_types")
        .select("id, name, default_unit_id, sort_order")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("product_type_attributes")
        .select(
          "product_type_id, is_required, is_variant_defining, sort_order, attributes(id, code, name, data_type, options, default_unit_id, help_text, is_active)",
        ),
    ]);
    if (types.error) throw types.error;
    if (links.error) throw links.error;
    return (types.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      default_unit_id: t.default_unit_id,
      attributes: (links.data ?? [])
        .filter((l) => l.product_type_id === t.id && l.attributes && l.attributes.is_active)
        .map((l) => ({
          id: l.attributes!.id,
          code: l.attributes!.code,
          name: l.attributes!.name,
          data_type: l.attributes!.data_type,
          options: l.attributes!.options ?? [],
          default_unit_id: l.attributes!.default_unit_id,
          help_text: l.attributes!.help_text,
          is_required: l.is_required,
          is_variant_defining: l.is_variant_defining,
          sort_order: l.sort_order,
        }))
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
  },
  staleTime: 10 * 60_000,
});

export const unitsQuery = queryOptions({
  queryKey: ["catalog", "units"],
  queryFn: async (): Promise<UnitLite[]> => {
    const { data, error } = await supabase
      .from("units")
      .select("id, code, name_singular, name_plural, symbol, kind, allows_decimal")
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw error;
    return data ?? [];
  },
  staleTime: 30 * 60_000,
});

export interface CategoryItem extends TreeItem {
  is_demo: boolean;
}

export const categoriesQuery = queryOptions({
  queryKey: ["catalog", "categories"],
  queryFn: async (): Promise<CategoryItem[]> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, parent_id, name, sort_order, depth, is_active, is_demo");
    if (error) throw error;
    return data ?? [];
  },
  staleTime: 5 * 60_000,
});

export const locationsQuery = queryOptions({
  queryKey: ["catalog", "locations"],
  queryFn: async (): Promise<CategoryItem[]> => {
    const { data, error } = await supabase
      .from("locations")
      .select("id, parent_id, name, sort_order, depth, is_active, is_demo");
    if (error) throw error;
    return data ?? [];
  },
  staleTime: 5 * 60_000,
});

export const staffQuery = queryOptions({
  queryKey: ["catalog", "staff"],
  queryFn: async (): Promise<Array<{ id: string; full_name: string; email: string | null }>> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name");
    if (error) throw error;
    return data ?? [];
  },
  staleTime: 10 * 60_000,
});

export const openSessionQuery = queryOptions({
  queryKey: ["catalog", "open-session"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("inventory_sessions")
      .select("id, name, started_at")
      .eq("is_open", true)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  staleTime: 5 * 60_000,
});

export interface CatalogFilters {
  q?: string | undefined;
  categoria?: string | undefined;
  porClasificar?: boolean | undefined;
  tipo?: string | undefined;
  ubicacion?: string | undefined;
  existencia?: "with" | "zero" | "pending" | undefined;
  foto?: "with" | "without" | undefined;
  revision?: "pending" | "validated" | undefined;
  registro?: RecordStatus | undefined;
  capturista?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
  color?: string | undefined;
  medida?: string | undefined;
  medidaValor?: string | undefined;
  costoPendiente?: boolean | undefined;
  orden?: "recent" | "sku" | "name" | "quantity" | undefined;
  pagina?: number | undefined;
}

export function catalogQuery(filters: CatalogFilters, pageSize: number) {
  return queryOptions({
    queryKey: ["catalog", "search", filters, pageSize],
    queryFn: async () => {
      const page = Math.max(1, filters.pagina ?? 1);
      const measureValue = filters.medidaValor
        ? Number(filters.medidaValor.replace(",", "."))
        : undefined;
      const raw = {
        _q: filters.q || undefined,
        _category_id: filters.categoria || undefined,
        _unclassified: filters.porClasificar || undefined,
        _product_type_id: filters.tipo || undefined,
        _location_id: filters.ubicacion || undefined,
        _stock: filters.existencia || undefined,
        _photo: filters.foto || undefined,
        _review: filters.revision || undefined,
        _record: filters.registro || undefined,
        _created_by: filters.capturista || undefined,
        _from: filters.desde || undefined,
        _to: filters.hasta || undefined,
        _color: filters.color || undefined,
        _measure_attr: filters.medida || undefined,
        _measure_value: Number.isFinite(measureValue) ? measureValue : undefined,
        _cost_pending: filters.costoPendiente || undefined,
        _sort: filters.orden || "recent",
        _limit: pageSize,
        _offset: (page - 1) * pageSize,
      };
      const args = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== undefined),
      ) as SearchArgs;
      const { data, error } = await supabase.rpc("search_catalog", args);
      if (error) throw error;
      const rows = data ?? [];
      return { rows, total: Number(rows[0]?.total_count ?? 0) };
    },
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

/** Ruta legible de una categoría o ubicación; null = «Por clasificar». */
export function treePath(items: TreeItem[], id: string | null | undefined): string | null {
  if (!id) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return parts.length ? parts.join(" › ") : null;
}
