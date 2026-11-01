// Herramientas de SOLO LECTURA del asistente de inventario.
// Todas usan el cliente con la sesión del usuario (RLS): nunca leen costos
// ni datos que la persona no pueda ver en la app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonSchema, tool } from "ai";

import type { Database } from "@/integrations/supabase/types";
import { normalizeText } from "@/lib/format";
import { minimumState } from "@/lib/stock";
import { descendantIds, pathOf, type TreeItem } from "@/lib/tree";

type Client = SupabaseClient<Database>;

interface LocationRow extends TreeItem {
  code: string | null;
}

const clampLimit = (v: unknown, def: number, max: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(Math.max(n, 1), max);
};

const STATE_LABEL = {
  below: "bajo mínimo",
  ok: "en nivel",
  pending: "pendiente de conteo",
} as const;

export function createInventoryTools(supabase: Client) {
  let locationsCache: LocationRow[] | null = null;
  const getLocations = async () => {
    if (locationsCache) return locationsCache;
    const { data, error } = await supabase
      .from("locations")
      .select("id, parent_id, name, code, sort_order, depth, is_active");
    if (error) throw new Error(error.message);
    locationsCache = (data ?? []) as LocationRow[];
    return locationsCache;
  };
  const locPath = async (id: string) => pathOf(await getLocations(), id, " > ");

  return {
    resumen_inventario: tool({
      description:
        "Resumen general del inventario: SKU registrados, contados, pendientes de conteo, SKU con existencia total en cero, ubicaciones activas, totales por unidad (nunca sumar unidades distintas) y resumen de alertas de mínimos.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      }),
      execute: async () => {
        const [ov, units, alerts] = await Promise.all([
          supabase.rpc("inventory_overview"),
          supabase.rpc("stock_totals_by_unit"),
          supabase.rpc("low_stock_summary"),
        ]);
        if (ov.error) throw new Error(ov.error.message);
        const o = ov.data?.[0];
        const a = alerts.data?.[0];
        return {
          skus_registrados: Number(o?.registered_skus ?? 0),
          skus_contados: Number(o?.counted_skus ?? 0),
          skus_pendientes_de_conteo: Number(o?.pending_count_skus ?? 0),
          skus_con_existencia_total_cero: Number(o?.zero_stock_skus ?? 0),
          ubicaciones_activas: Number(o?.active_locations ?? 0),
          totales_por_unidad: (units.data ?? []).map((u) => ({
            unidad: u.unit_plural,
            cantidad_total: Number(u.total),
            skus: Number(u.sku_count),
          })),
          minimos: {
            configurados: Number(a?.configured_count ?? 0),
            bajo_minimo: Number(a?.below_count ?? 0),
            con_minimo_pendientes_de_conteo: Number(a?.pending_count ?? 0),
          },
        };
      },
    }),

    buscar_skus: tool({
      description:
        "Busca SKU confirmados por nombre, color, medida, material, diseño, tipo o código. Devuelve SKU, producto, variante, atributos, unidad base y existencia total. Úsala antes de responder sobre un producto si no conoces su SKU exacto.",
      inputSchema: jsonSchema<{ texto: string }>({
        type: "object",
        properties: {
          texto: { type: "string", description: "Palabras clave, por ejemplo 'listón rojo 25 mm'" },
        },
        required: ["texto"],
        additionalProperties: false,
      }),
      execute: async ({ texto }) => {
        const q = String(texto ?? "").slice(0, 200);
        const { data, error } = await supabase.rpc("suggest_variant_candidates", {
          _text: q,
          _limit: 15,
        });
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        const ids = rows.map((r) => r.id);
        const stock = ids.length
          ? await supabase.from("stock_levels").select("variant_id, quantity").in("variant_id", ids)
          : { data: [] as { variant_id: string; quantity: number }[] };
        const totals = new Map<string, { total: number; ubicaciones: number }>();
        for (const s of stock.data ?? []) {
          const t = totals.get(s.variant_id) ?? { total: 0, ubicaciones: 0 };
          t.total += Number(s.quantity);
          t.ubicaciones += 1;
          totals.set(s.variant_id, t);
        }
        return {
          resultados: rows.map((r) => {
            const t = totals.get(r.id);
            return {
              sku: r.sku,
              producto: r.product_name,
              variante: r.variant_label,
              tipo: r.product_type,
              atributos: r.attributes,
              unidad: r.unit_plural,
              existencia_total: t ? Math.round(t.total * 1000) / 1000 : null,
              ubicaciones_con_conteo: t?.ubicaciones ?? 0,
              estado_conteo: t ? "contado" : "pendiente de conteo",
            };
          }),
          nota: rows.length === 0 ? "Sin coincidencias. Prueba con otras palabras." : undefined,
        };
      },
    }),

    existencias_de_sku: tool({
      description:
        "Detalle de un SKU exacto: existencia por ubicación, mínimo configurado en cada ubicación, estado (bajo mínimo, en nivel o pendiente de conteo) y metros por rollo si se conocen.",
      inputSchema: jsonSchema<{ sku: string }>({
        type: "object",
        properties: {
          sku: { type: "string", description: "Código SKU, por ejemplo DEMO-000002 o ALY-000001" },
        },
        required: ["sku"],
        additionalProperties: false,
      }),
      execute: async ({ sku }) => {
        const code = String(sku ?? "")
          .trim()
          .toUpperCase()
          .slice(0, 40);
        const { data: v, error } = await supabase
          .from("variants")
          .select(
            "id, sku, variant_label, record_status, units_per_presentation, products(name), base_unit:units!variants_base_unit_id_fkey(name_singular, name_plural)",
          )
          .eq("sku", code)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!v || v.record_status === "archived")
          return { encontrado: false, mensaje: `No existe un SKU activo con el código ${code}.` };
        const [stock, mins] = await Promise.all([
          supabase
            .from("stock_levels")
            .select("location_id, quantity, counted_at")
            .eq("variant_id", v.id),
          supabase
            .from("stock_minimums")
            .select("location_id, min_quantity")
            .eq("variant_id", v.id),
        ]);
        const minMap = new Map(
          (mins.data ?? []).map((m) => [m.location_id, Number(m.min_quantity)]),
        );
        const unit = v.base_unit as { name_singular: string; name_plural: string } | null;
        const ubicaciones = await Promise.all(
          (stock.data ?? []).map(async (s) => {
            const min = minMap.get(s.location_id);
            return {
              ubicacion: await locPath(s.location_id),
              cantidad: Number(s.quantity),
              minimo: min ?? null,
              estado:
                min !== undefined
                  ? STATE_LABEL[minimumState(Number(s.quantity), min)]
                  : "sin mínimo",
              fecha_conteo: s.counted_at,
            };
          }),
        );
        const counted = new Set((stock.data ?? []).map((s) => s.location_id));
        const minimosSinConteo = await Promise.all(
          [...minMap]
            .filter(([loc]) => !counted.has(loc))
            .map(async ([loc, min]) => ({ ubicacion: await locPath(loc), minimo: min })),
        );
        const total = ubicaciones.reduce((acc, u) => acc + u.cantidad, 0);
        return {
          encontrado: true,
          sku: v.sku,
          producto: (v.products as { name: string } | null)?.name,
          variante: v.variant_label,
          estado_registro: v.record_status === "draft" ? "borrador" : "registrado",
          unidad: unit?.name_plural,
          metros_o_unidades_por_rollo: v.units_per_presentation
            ? Number(v.units_per_presentation)
            : null,
          existencia_total: ubicaciones.length ? Math.round(total * 1000) / 1000 : null,
          estado_conteo: ubicaciones.length ? "contado" : "pendiente de conteo",
          ubicaciones,
          minimos_en_ubicaciones_sin_conteo: minimosSinConteo,
        };
      },
    }),

    alertas_bajo_minimo: tool({
      description:
        "Lista los SKU cuya existencia contada está por debajo del mínimo configurado, ordenados por urgencia, con su ubicación y cuánto falta.",
      inputSchema: jsonSchema<{ limite: number | null }>({
        type: "object",
        properties: {
          limite: {
            type: ["number", "null"],
            description: "Máximo de resultados (por defecto 20)",
          },
        },
        required: ["limite"],
        additionalProperties: false,
      }),
      execute: async ({ limite }) => {
        const { data, error } = await supabase.rpc("list_stock_minimums", {
          _only_alerts: true,
          _limit: clampLimit(limite, 20, 50),
          _offset: 0,
        });
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        return {
          total_alertas: Number(rows[0]?.total_count ?? 0),
          alertas: await Promise.all(
            rows.map(async (r) => ({
              sku: r.sku,
              producto: r.product_name,
              variante: r.variant_label,
              ubicacion: await locPath(r.location_id),
              existencia: Number(r.quantity),
              minimo: Number(r.min_quantity),
              faltan: Math.round((Number(r.min_quantity) - Number(r.quantity)) * 1000) / 1000,
              unidad: r.unit_plural,
              fecha_conteo: r.counted_at,
            })),
          ),
        };
      },
    }),

    minimos_configurados: tool({
      description:
        "Lista los niveles mínimos configurados (por SKU y ubicación) con la existencia actual y su estado. Acepta un texto opcional para filtrar por SKU o nombre.",
      inputSchema: jsonSchema<{ filtro: string | null }>({
        type: "object",
        properties: {
          filtro: { type: ["string", "null"], description: "Texto opcional para filtrar" },
        },
        required: ["filtro"],
        additionalProperties: false,
      }),
      execute: async ({ filtro }) => {
        const { data, error } = await supabase.rpc("list_stock_minimums", {
          _search: filtro ? String(filtro).slice(0, 100) : "",
          _only_alerts: false,
          _limit: 50,
          _offset: 0,
        });
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        return {
          total: Number(rows[0]?.total_count ?? 0),
          minimos: await Promise.all(
            rows.map(async (r) => {
              const q = r.quantity === null ? null : Number(r.quantity);
              return {
                sku: r.sku,
                producto: r.product_name,
                variante: r.variant_label,
                ubicacion: await locPath(r.location_id),
                minimo: Number(r.min_quantity),
                existencia: q,
                estado: STATE_LABEL[minimumState(q, Number(r.min_quantity))],
                unidad: r.unit_plural,
              };
            }),
          ),
        };
      },
    }),

    inventario_por_ubicacion: tool({
      description:
        "Muestra qué SKU hay en una ubicación (incluye las ubicaciones que contiene, por ejemplo una bodega incluye sus pasillos, estantes y cajas), con cantidad, unidad, mínimo y estado. Si el nombre es ambiguo devuelve las opciones.",
      inputSchema: jsonSchema<{ ubicacion: string }>({
        type: "object",
        properties: {
          ubicacion: {
            type: "string",
            description: "Nombre, código o ruta de la ubicación, por ejemplo 'Caja 02' o 'Bodega'",
          },
        },
        required: ["ubicacion"],
        additionalProperties: false,
      }),
      execute: async ({ ubicacion }) => {
        const locations = await getLocations();
        const q = normalizeText(String(ubicacion ?? ""));
        const scored = locations
          .map((l) => {
            const name = normalizeText(l.name);
            const path = normalizeText(pathOf(locations, l.id, " > "));
            const code = l.code ? normalizeText(l.code) : "";
            const score =
              name === q || code === q ? 3 : path.endsWith(q) ? 2 : path.includes(q) ? 1 : 0;
            return { l, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        if (scored.length === 0) {
          return {
            encontrada: false,
            mensaje: "No encontré esa ubicación.",
            ubicaciones_disponibles: locations
              .filter((l) => l.is_active)
              .map((l) => pathOf(locations, l.id, " > ")),
          };
        }
        const best = scored.filter((x) => x.score === scored[0]!.score);
        if (best.length > 1) {
          return {
            encontrada: false,
            ambigua: true,
            opciones: best.map((x) => pathOf(locations, x.l.id, " > ")),
          };
        }
        const target = best[0]!.l;
        const ids = [target.id, ...descendantIds(locations, target.id)];
        const { data, error } = await supabase
          .from("stock_levels")
          .select(
            "location_id, quantity, variant_id, variants(sku, variant_label, record_status, products(name), base_unit:units!variants_base_unit_id_fkey(name_plural))",
          )
          .in("location_id", ids)
          .limit(300);
        if (error) throw new Error(error.message);
        const mins = await supabase
          .from("stock_minimums")
          .select("variant_id, location_id, min_quantity")
          .in("location_id", ids);
        const minMap = new Map(
          (mins.data ?? []).map((m) => [
            `${m.variant_id}:${m.location_id}`,
            Number(m.min_quantity),
          ]),
        );
        type Row = {
          location_id: string;
          quantity: number;
          variant_id: string;
          variants: {
            sku: string | null;
            variant_label: string | null;
            record_status: string;
            products: { name: string } | null;
            base_unit: { name_plural: string } | null;
          } | null;
        };
        const rows = ((data ?? []) as unknown as Row[]).filter(
          (r) => r.variants?.record_status === "registered",
        );
        const totals = new Map<string, number>();
        const items = rows.map((r) => {
          const unit = r.variants?.base_unit?.name_plural ?? "unidades";
          totals.set(unit, (totals.get(unit) ?? 0) + Number(r.quantity));
          const min = minMap.get(`${r.variant_id}:${r.location_id}`);
          return {
            sku: r.variants?.sku,
            producto: r.variants?.products?.name,
            variante: r.variants?.variant_label,
            ubicacion: pathOf(locations, r.location_id, " > "),
            cantidad: Number(r.quantity),
            unidad: unit,
            minimo: min ?? null,
            estado:
              min !== undefined ? STATE_LABEL[minimumState(Number(r.quantity), min)] : "sin mínimo",
          };
        });
        return {
          encontrada: true,
          ubicacion: pathOf(locations, target.id, " > "),
          activa: target.is_active,
          incluye_sububicaciones: ids.length > 1,
          skus_con_conteo: items.length,
          totales_por_unidad: [...totals].map(([unidad, cantidad]) => ({
            unidad,
            cantidad: Math.round(cantidad * 1000) / 1000,
          })),
          articulos: items.slice(0, 80),
          truncado: items.length > 80,
        };
      },
    }),

    listar_ubicaciones: tool({
      description:
        "Lista todas las ubicaciones físicas con su ruta completa, si están activas y cuántos SKU con existencia tiene cada una.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      }),
      execute: async () => {
        const locations = await getLocations();
        const { data } = await supabase.rpc("location_stock_counts");
        const counts = new Map((data ?? []).map((r) => [r.location_id, Number(r.sku_count)]));
        return {
          ubicaciones: locations
            .map((l) => ({
              ruta: pathOf(locations, l.id, " > "),
              codigo: l.code,
              activa: l.is_active,
              skus_con_conteo: counts.get(l.id) ?? 0,
            }))
            .sort((a, b) => a.ruta.localeCompare(b.ruta, "es")),
        };
      },
    }),

    skus_pendientes_de_conteo: tool({
      description:
        "Lista los SKU registrados que todavía no tienen ningún conteo (pendiente de conteo es distinto de cero).",
      inputSchema: jsonSchema<{ limite: number | null }>({
        type: "object",
        properties: {
          limite: {
            type: ["number", "null"],
            description: "Máximo de resultados (por defecto 30)",
          },
        },
        required: ["limite"],
        additionalProperties: false,
      }),
      execute: async ({ limite }) => {
        const { data, error } = await supabase.rpc("pending_count_variants", {
          _limit: clampLimit(limite, 30, 100),
        });
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        return {
          total: Number(rows[0]?.total_count ?? 0),
          skus: rows.map((r) => ({
            sku: r.sku,
            producto: r.product_name,
            variante: r.variant_label,
            unidad: r.unit_plural,
          })),
        };
      },
    }),
  };
}
