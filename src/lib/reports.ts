// Informes del Administrador: construcción de columnas a partir de export_report.
import type { CellValue, TableData } from "@/lib/files";

export type ReportKind =
  | "catalog"
  | "ids"
  | "by_location"
  | "pending_count"
  | "pending_photo"
  | "incomplete";

export interface ExportRow {
  id: string;
  sku: string | null;
  product_id?: string;
  product_name: string;
  variant_label: string | null;
  product_type?: string | null;
  categories?: string[] | null;
  attributes?: Record<string, string | null> | null;
  base_unit: string;
  presentation_unit?: string | null;
  units_per_presentation?: number | null;
  total_quantity?: number | null;
  locations?: string | null;
  location?: string;
  quantity?: number;
  counted_at?: string | null;
  counted_by_name?: string | null;
  record_status: "draft" | "registered" | "archived";
  review_status?: "pending" | "validated";
  photo_status?: "pending" | "uploaded" | "approved";
  images?: string[] | null;
  supplier_code?: string | null;
  legacy_code?: string | null;
  usage_tags?: string | null;
  description?: string | null;
  created_by_name?: string | null;
  created_at?: string;
  confirmed_at?: string | null;
  updated_at?: string;
  is_demo?: boolean;
  missing?: string[] | null;
  cost?: number | null;
  currency?: string | null;
  cost_updated_at?: string | null;
}

export interface ReportPage {
  total: number;
  rows: ExportRow[];
  attribute_names?: string[];
}

const RECORD = { draft: "Borrador", registered: "Registrado", archived: "Archivado" } as const;
const REVIEW = { pending: "Pendiente", validated: "Validado" } as const;
const PHOTO = { pending: "Pendiente", uploaded: "Cargada", approved: "Aprobada" } as const;

function date(v: string | null | undefined): CellValue {
  return v ? new Date(v) : null;
}

/** Valor estimado: solo con cantidad y costo conocidos; nunca se rellena con cero. */
export function estimatedValue(quantity: number | null | undefined, cost: number | null | undefined): number | null {
  if (quantity === null || quantity === undefined || cost === null || cost === undefined) return null;
  return Math.round(quantity * cost * 100) / 100;
}

/** Cobertura de la valoración: porcentaje de SKU contados que tienen costo. */
export function valuationCoverage(counted: number, valued: number): number {
  if (counted <= 0) return 0;
  return Math.round((valued / counted) * 1000) / 10;
}

export interface BuildOptions {
  kind: ReportKind;
  includeCosts: boolean;
  attributeNames: string[];
  qrUrlFor: (id: string) => string;
}

/** Una fila por SKU (o por SKU y ubicación en «by_location»), con columnas en español. */
export function buildReportTable(rows: ExportRow[], opts: BuildOptions): TableData {
  if (opts.kind === "by_location") {
    const headers = [
      "ID", "SKU", "Producto", "Variante", "Ubicación", "Cantidad", "Unidad base",
      "Estado del registro", "Fecha de conteo", "Contó", "Demo",
      ...(opts.includeCosts ? ["Costo por unidad base", "Moneda", "Valor estimado"] : []),
    ];
    return {
      headers,
      rows: rows.map((r) => [
        r.id, r.sku, r.product_name, r.variant_label, r.location, r.quantity ?? null, r.base_unit,
        RECORD[r.record_status], date(r.counted_at), r.counted_by_name, r.is_demo ? "Sí" : "No",
        ...(opts.includeCosts
          ? [r.cost ?? "Costo pendiente", r.currency, estimatedValue(r.quantity, r.cost)]
          : []),
      ]),
    };
  }

  const depth = Math.max(1, ...rows.map((r) => r.categories?.length ?? 0));
  const used = new Set(rows.flatMap((r) => Object.keys(r.attributes ?? {})));
  const attrCols = [
    ...opts.attributeNames.filter((n) => used.has(n)),
    ...[...used].filter((n) => !opts.attributeNames.includes(n)).sort(),
  ];
  const headers = [
    "ID", "SKU", "Producto", "Variante", "Tipo",
    ...Array.from({ length: depth }, (_, i) => `Categoría nivel ${i + 1}`),
    ...attrCols,
    "Cantidad total", "Unidad base", "Estado del conteo", "Ubicaciones", "Presentación", "Contenido por presentación",
    ...(opts.includeCosts ? ["Costo por unidad base", "Moneda", "Costo actualizado", "Valor estimado"] : []),
    "Estado del registro", "Estado de revisión", "Estado de fotografía", "Imágenes", "URL del QR",
    "Código de proveedor", "Código anterior", "Usos", "Descripción", "Capturó", "Fecha de captura",
    "Fecha de confirmación", "Última modificación", "Demo",
    ...(opts.kind === "incomplete" ? ["Datos faltantes"] : []),
  ];
  return {
    headers,
    rows: rows.map((r) => {
      const cats = r.categories ?? [];
      return [
        r.id, r.sku, r.product_name, r.variant_label, r.product_type ?? null,
        ...Array.from({ length: depth }, (_, i) => cats[i] ?? (i === 0 ? "Por clasificar" : null)),
        ...attrCols.map((n) => r.attributes?.[n] ?? null),
        r.total_quantity ?? null, r.base_unit,
        r.total_quantity === null || r.total_quantity === undefined ? "Pendiente de conteo" : "Realizado",
        r.locations ?? null, r.presentation_unit ?? null,
        r.presentation_unit ? (r.units_per_presentation ?? "Pendiente") : null,
        ...(opts.includeCosts
          ? [r.cost ?? "Costo pendiente", r.currency ?? null, date(r.cost_updated_at), estimatedValue(r.total_quantity, r.cost)]
          : []),
        RECORD[r.record_status], r.review_status ? REVIEW[r.review_status] : null,
        r.photo_status ? PHOTO[r.photo_status] : null, (r.images ?? []).join(" | ") || null,
        r.sku ? opts.qrUrlFor(r.id) : null,
        r.supplier_code ?? null, r.legacy_code ?? null, r.usage_tags || null, r.description ?? null,
        r.created_by_name ?? null, date(r.created_at), date(r.confirmed_at), date(r.updated_at),
        r.is_demo ? "Sí" : "No",
        ...(opts.kind === "incomplete" ? [(r.missing ?? []).join("; ")] : []),
      ];
    }),
  };
}

export const REPORTS: Array<{ kind: Exclude<ReportKind, "ids">; title: string; description: string; file: string }> = [
  { kind: "catalog", title: "Catálogo completo", description: "Una fila por SKU con categorías por nivel, atributos, existencias, estados, imágenes y URL del QR.", file: "catalogo" },
  { kind: "by_location", title: "Inventario por ubicación", description: "Una fila por SKU y ubicación. No duplica ni infla los totales del catálogo.", file: "inventario-por-ubicacion" },
  { kind: "pending_count", title: "Pendientes de conteo", description: "SKU registrados que todavía no se han contado en ninguna ubicación.", file: "pendientes-de-conteo" },
  { kind: "pending_photo", title: "Pendientes de fotografía", description: "SKU sin fotografía, ordenados por ubicación para organizar la sesión de fotos.", file: "pendientes-de-fotografia" },
  { kind: "incomplete", title: "Datos incompletos", description: "SKU por clasificar, con atributos pendientes, sin conteo o (si incluyes costos) sin costo.", file: "datos-incompletos" },
];
