// Importación masiva desde Excel/CSV. Aquí solo se interpreta y valida el archivo;
// cada producto se guarda con save_capture (el servidor vuelve a validar todo).
import type { AttrDef, AttrPayload, UnitLite } from "@/lib/capture";
import { normalizeText } from "@/lib/format";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_VARIANTS_PER_PRODUCT = 60;
const PRESENTATION_CODES = new Set(["presentacion", "contenido_presentacion"]);

interface TreeLike {
  id: string;
  parent_id: string | null;
  name: string;
  is_active?: boolean;
}

export const FIXED_COLUMNS = [
  {
    key: "producto",
    header: "Producto",
    help: "Obligatorio. Las filas con el mismo producto se guardan como variantes del mismo modelo.",
  },
  {
    key: "variante",
    header: "Variante",
    help: "Opcional. Si se deja vacío se arma con las características que distinguen la variante.",
  },
  {
    key: "categoria",
    header: "Categoría",
    help: "Ruta separada por «>», p. ej. Listones > Textiles. Vacío = Por clasificar.",
  },
  {
    key: "unidad",
    header: "Unidad base",
    help: "Obligatoria si el tipo no tiene unidad predeterminada (pieza, metro, rollo…).",
  },
  {
    key: "cantidad",
    header: "Cantidad",
    help: "Cantidad contada en la unidad base. 0 = se contó y no hay. Vacío o «pendiente» = pendiente de conteo.",
  },
  {
    key: "ubicacion",
    header: "Ubicación",
    help: "Ruta separada por «>». Obligatoria cuando hay cantidad.",
  },
  { key: "presentacion", header: "Presentación", help: "Opcional (p. ej. rollo, paquete)." },
  {
    key: "contenido",
    header: "Contenido por presentación",
    help: "Cuántas unidades base trae cada presentación. Vacío = pendiente.",
  },
  { key: "proveedor", header: "Código de proveedor", help: "Opcional." },
  { key: "anterior", header: "Código anterior", help: "Opcional." },
  { key: "descripcion", header: "Descripción", help: "Opcional." },
  { key: "usos", header: "Usos", help: "Etiquetas separadas por coma." },
  { key: "notas", header: "Notas", help: "Opcional." },
] as const;

type FixedKey = (typeof FIXED_COLUMNS)[number]["key"];

const ALIASES: Record<string, FixedKey> = {
  producto: "producto",
  nombre: "producto",
  "nombre del producto": "producto",
  modelo: "producto",
  variante: "variante",
  "nombre de variante": "variante",
  categoria: "categoria",
  "ruta de categoria": "categoria",
  "unidad base": "unidad",
  unidad: "unidad",
  cantidad: "cantidad",
  "cantidad contada": "cantidad",
  existencia: "cantidad",
  ubicacion: "ubicacion",
  presentacion: "presentacion",
  "contenido por presentacion": "contenido",
  contenido: "contenido",
  "codigo de proveedor": "proveedor",
  proveedor: "proveedor",
  "codigo anterior": "anterior",
  descripcion: "descripcion",
  "descripcion breve": "descripcion",
  usos: "usos",
  "etiquetas de uso": "usos",
  notas: "notas",
  observaciones: "notas",
};

function headerKey(raw: string): { base: string; unitHint: string | null } {
  const m = raw.match(/\(([^)]*)\)\s*\*?\s*$/);
  const base = normalizeText(raw.replace(/\([^)]*\)/g, "").replace(/\*/g, ""));
  return { base, unitHint: m?.[1]?.trim() || null };
}

export function attributeHeader(def: AttrDef, units: UnitLite[]): string {
  const u =
    def.data_type === "number" ? units.find((x) => x.id === def.default_unit_id) : undefined;
  return `${def.name}${u ? ` (${u.symbol ?? u.name_plural})` : ""}${def.is_required ? " *" : ""}`;
}

export function templateHeaders(defs: AttrDef[], units: UnitLite[]): string[] {
  const attrs = defs.filter((d) => !PRESENTATION_CODES.has(d.code));
  return [
    ...FIXED_COLUMNS.slice(0, 2).map((c) => c.header + (c.key === "producto" ? " *" : "")),
    ...attrs.map((d) => attributeHeader(d, units)),
    ...FIXED_COLUMNS.slice(2).map((c) => c.header),
  ];
}

export function findUnit(
  raw: string,
  units: UnitLite[],
  kind?: UnitLite["kind"],
): UnitLite | undefined {
  const t = normalizeText(raw);
  if (!t) return undefined;
  return units.find(
    (u) =>
      (!kind || u.kind === kind) &&
      [u.code, u.name_singular, u.name_plural, u.symbol ?? ""].some(
        (x) => x && normalizeText(x) === t,
      ),
  );
}

/** Busca una categoría o ubicación por su ruta («A > B > C») o por un nombre único. */
export function findTreePath(
  raw: string,
  items: TreeLike[],
): { id: string } | { error: string } | null {
  const parts = raw
    .split(/\s*(?:>|›|\/|\\)\s*/)
    .map(normalizeText)
    .filter(Boolean);
  if (!parts.length) return null;
  const active = items.filter((i) => i.is_active !== false);
  let parent: string | null = null;
  let found: TreeLike | undefined;
  if (parts.length === 1) {
    const hits = active.filter((i) => normalizeText(i.name) === parts[0]);
    if (hits.length === 1) return { id: hits[0]!.id };
    if (hits.length > 1)
      return { error: `«${raw}» existe en varias ramas; escribe la ruta completa con «>».` };
    return { error: `No existe «${raw}».` };
  }
  for (const part of parts) {
    found = active.find((i) => i.parent_id === parent && normalizeText(i.name) === part);
    if (!found) return { error: `No existe «${raw}» (revisa «${part}»).` };
    parent = found.id;
  }
  return found ? { id: found.id } : null;
}

export function parseQuantity(
  raw: string,
): { pending: true } | { value: number } | { error: string } {
  const t = normalizeText(raw);
  if (t === "" || t === "pendiente" || t === "pendiente de conteo") return { pending: true };
  const n = Number(t.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return { error: `Cantidad no válida: «${raw}»` };
  if (n < 0) return { error: "La cantidad no puede ser negativa" };
  return { value: n };
}

/** Interpreta la celda de un atributo. null = celda vacía (no se envía). */
export function parseAttrCell(
  def: AttrDef,
  raw: string,
  units: UnitLite[],
  unitHint: string | null,
): { payload: AttrPayload; display: string | null } | { error: string } | null {
  const text = raw.trim();
  const t = normalizeText(text);
  if (!t) return null;
  if (["no aplica", "n/a", "na", "n.a."].includes(t)) {
    return { payload: { attribute_id: def.id, state: "not_applicable" }, display: null };
  }
  if (["pendiente", "dato pendiente", "?"].includes(t)) {
    return { payload: { attribute_id: def.id, state: "pending" }, display: null };
  }
  if (def.data_type === "number") {
    const m = text.match(/^(-?\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) return { error: `«${def.name}»: escribe un número (p. ej. 25 o 25 mm).` };
    const n = Number(m[1]!.replace(",", "."));
    if (n < 0) return { error: `«${def.name}» no puede ser negativo.` };
    const unitText = m[2]?.trim() || unitHint || "";
    let unitId = def.default_unit_id;
    let label = units.find((u) => u.id === unitId);
    if (unitText) {
      const u = findUnit(unitText, units, "measure") ?? findUnit(unitText, units);
      if (!u) return { error: `«${def.name}»: no se reconoce la unidad «${unitText}».` };
      unitId = u.id;
      label = u;
    }
    return {
      payload: { attribute_id: def.id, state: "value", number: n, unit_id: unitId },
      display: `${n}${label ? ` ${label.symbol ?? label.name_plural}` : ""}`,
    };
  }
  const match = (v: string) => def.options.find((o) => normalizeText(o) === normalizeText(v));
  if (def.data_type === "select") {
    if (def.options.length === 0)
      return { payload: { attribute_id: def.id, state: "value", text }, display: text };
    const o = match(text);
    if (!o)
      return { error: `«${def.name}»: «${text}» no está en la lista (${def.options.join(", ")}).` };
    return { payload: { attribute_id: def.id, state: "value", text: o }, display: o };
  }
  if (def.data_type === "multiselect") {
    const parts = text
      .split(/[,;|]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      const o = def.options.length ? match(p) : p;
      if (!o)
        return { error: `«${def.name}»: «${p}» no está en la lista (${def.options.join(", ")}).` };
      if (!out.includes(o)) out.push(o);
    }
    return {
      payload: { attribute_id: def.id, state: "value", options: out },
      display: out.join(", "),
    };
  }
  if (text.length > 300) return { error: `«${def.name}»: máximo 300 caracteres.` };
  return { payload: { attribute_id: def.id, state: "value", text }, display: text };
}

export interface ImportVariant {
  line: number;
  variant_label: string | null;
  supplier_code: string;
  legacy_code: string;
  notes: string;
  base_unit_id: string | null;
  presentation_unit_id: string | null;
  units_per_presentation: number | null;
  attributes: AttrPayload[];
  count: { pending: true } | { location_id: string; quantity: number };
  /** Firma de las características que distinguen la variante (null si falta alguna). */
  signature: string | null;
  errors: string[];
}

export interface ImportGroup {
  key: string;
  product: {
    name: string;
    product_type_id: string;
    category_id: string | null;
    description: string;
    usage_tags: string[];
    notes: string;
  };
  variants: ImportVariant[];
  errors: string[];
}

export interface ParsedImport {
  groups: ImportGroup[];
  unknownColumns: string[];
  fileErrors: string[];
  rowCount: number;
}

function splitTags(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const t = part.trim().slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

export function parseImport(
  matrix: string[][],
  ctx: {
    typeId: string;
    defaultUnitId: string | null;
    defs: AttrDef[];
    units: UnitLite[];
    categories: TreeLike[];
    locations: TreeLike[];
    confirming: boolean;
  },
): ParsedImport {
  const fileErrors: string[] = [];
  const [header, ...body] = matrix;
  if (!header)
    return { groups: [], unknownColumns: [], fileErrors: ["El archivo está vacío."], rowCount: 0 };
  if (body.length > MAX_IMPORT_ROWS)
    fileErrors.push(
      `El archivo tiene ${body.length} filas; el máximo es ${MAX_IMPORT_ROWS}. Divídelo en varios archivos.`,
    );

  const defs = ctx.defs.filter((d) => !PRESENTATION_CODES.has(d.code));
  const fixedIdx = new Map<FixedKey, number>();
  const attrIdx: Array<{ def: AttrDef; col: number; unitHint: string | null }> = [];
  const unknownColumns: string[] = [];
  header.forEach((raw, col) => {
    if (!raw.trim()) return;
    const { base, unitHint } = headerKey(raw);
    const fixed = ALIASES[base];
    if (fixed && !fixedIdx.has(fixed)) {
      fixedIdx.set(fixed, col);
      return;
    }
    const def = defs.find(
      (d) => normalizeText(d.name) === base || d.code === base.replace(/\s+/g, "_"),
    );
    if (def && !attrIdx.some((a) => a.def.id === def.id)) attrIdx.push({ def, col, unitHint });
    else unknownColumns.push(raw.trim());
  });
  if (!fixedIdx.has("producto")) fileErrors.push("Falta la columna «Producto».");
  if (fileErrors.length) return { groups: [], unknownColumns, fileErrors, rowCount: body.length };

  const cell = (row: string[], key: FixedKey) => {
    const i = fixedIdx.get(key);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const groups = new Map<string, ImportGroup>();
  body.forEach((row, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const name = cell(row, "producto");
    if (!name) {
      if (row.every((c) => !c.trim())) return;
      errors.push("Falta el nombre del producto.");
    }
    if (name.length > 160) errors.push("El nombre admite hasta 160 caracteres.");

    let categoryId: string | null = null;
    const catRaw = cell(row, "categoria");
    if (catRaw && normalizeText(catRaw) !== "por clasificar") {
      const r = findTreePath(catRaw, ctx.categories);
      if (r && "error" in r) errors.push(`Categoría: ${r.error}`);
      else if (r) categoryId = r.id;
    }

    let baseUnitId = ctx.defaultUnitId;
    const unitRaw = cell(row, "unidad");
    if (unitRaw) {
      const u = findUnit(unitRaw, ctx.units, "inventory");
      if (!u) errors.push(`Unidad base no reconocida: «${unitRaw}».`);
      else baseUnitId = u.id;
    }
    if (!baseUnitId) errors.push("Falta la unidad base.");
    const baseUnit = ctx.units.find((u) => u.id === baseUnitId);

    let presentationId: string | null = null;
    const presRaw = cell(row, "presentacion");
    if (presRaw) {
      const u = findUnit(presRaw, ctx.units, "inventory");
      if (!u) errors.push(`Presentación no reconocida: «${presRaw}».`);
      else presentationId = u.id;
    }
    let factor: number | null = null;
    const factorRaw = cell(row, "contenido");
    if (factorRaw && normalizeText(factorRaw) !== "pendiente") {
      const n = Number(factorRaw.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0)
        errors.push("El contenido por presentación debe ser mayor que cero.");
      else factor = n;
    }

    const attributes: AttrPayload[] = [];
    const definingText: string[] = [];
    for (const { def, col, unitHint } of attrIdx) {
      const r = parseAttrCell(def, row[col] ?? "", ctx.units, unitHint);
      if (r && "error" in r) errors.push(r.error);
      else if (r) {
        attributes.push(r.payload);
        if (def.is_variant_defining && r.display) definingText.push(r.display);
      }
    }
    if (ctx.confirming) {
      for (const d of defs.filter((x) => x.is_required)) {
        if (!attributes.some((a) => a.attribute_id === d.id)) {
          errors.push(`«${d.name}» es obligatorio: escribe el valor, «pendiente» o «no aplica».`);
        }
      }
    }

    const definingDefs = defs.filter((d) => d.is_variant_defining);
    const definingVals = definingDefs.map((d) => attributes.find((a) => a.attribute_id === d.id));
    const signature =
      definingDefs.length > 0 && definingVals.every((a) => a && a.state !== "pending")
        ? JSON.stringify(
            definingVals.map((a) =>
              a!.state === "not_applicable"
                ? "-"
                : normalizeText(String(a!.text ?? a!.number ?? "")) +
                  "|" +
                  (a!.unit_id ?? "") +
                  "|" +
                  (a!.options ?? []).map(normalizeText).sort().join(","),
            ),
          )
        : null;

    let count: ImportVariant["count"] = { pending: true };
    const q = parseQuantity(cell(row, "cantidad"));
    if ("error" in q) errors.push(q.error);
    else if ("value" in q) {
      if (baseUnit && !baseUnit.allows_decimal && !Number.isInteger(q.value)) {
        errors.push(`La unidad «${baseUnit.name_plural}» solo admite cantidades enteras.`);
      }
      const locRaw = cell(row, "ubicacion");
      const loc = locRaw ? findTreePath(locRaw, ctx.locations) : null;
      if (!loc) errors.push("Escribe la ubicación de la cantidad contada.");
      else if ("error" in loc) errors.push(`Ubicación: ${loc.error}`);
      else count = { location_id: loc.id, quantity: q.value };
    }

    const key = normalizeText(name) || `__fila_${line}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        product: {
          name,
          product_type_id: ctx.typeId,
          category_id: categoryId,
          description: cell(row, "descripcion").slice(0, 1000),
          usage_tags: splitTags(cell(row, "usos")),
          notes: cell(row, "notas").slice(0, 2000),
        },
        variants: [],
        errors: [],
      };
      groups.set(key, group);
    } else if (catRaw && group.product.category_id !== categoryId) {
      errors.push("Tiene otra categoría que la primera fila de este mismo producto.");
    }
    group.variants.push({
      line,
      variant_label: cell(row, "variante").slice(0, 160) || definingText.join(" · ") || null,
      supplier_code: cell(row, "proveedor").slice(0, 60),
      legacy_code: cell(row, "anterior").slice(0, 60),
      notes: "",
      base_unit_id: baseUnitId,
      presentation_unit_id: presentationId,
      units_per_presentation: factor,
      attributes,
      count,
      signature,
      errors,
    });
  });

  for (const g of groups.values()) {
    if (g.variants.length > MAX_VARIANTS_PER_PRODUCT) {
      g.errors.push(
        `«${g.product.name}» tiene ${g.variants.length} filas; el máximo por producto es ${MAX_VARIANTS_PER_PRODUCT}.`,
      );
    }
    const seen = new Map<string, number>();
    for (const v of g.variants) {
      if (!v.signature) continue;
      const first = seen.get(v.signature);
      if (first !== undefined) {
        v.errors.push(`Repite las mismas características que la fila ${first} del mismo producto.`);
      } else seen.set(v.signature, v.line);
    }
  }

  return { groups: [...groups.values()], unknownColumns, fileErrors, rowCount: body.length };
}

/** UUID determinista: reimportar el mismo archivo no duplica productos ni conteos. */
export async function stableUuid(seed: string): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  buf[6] = (buf[6]! & 0x0f) | 0x40;
  buf[8] = (buf[8]! & 0x3f) | 0x80;
  const hex = Array.from(buf.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function fileFingerprint(file: File): Promise<string> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return Array.from(buf.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
