// Reglas de la captura rápida (Bloque B). El servidor (save_capture,
// _record_initial_count) vuelve a validar todo; aquí solo se guía a la persona.

export type AttrDataType = "text" | "number" | "select" | "multiselect";
export type AttrState = "value" | "not_applicable" | "pending";

export interface AttrDef {
  id: string;
  code: string;
  name: string;
  data_type: AttrDataType;
  options: string[];
  default_unit_id: string | null;
  help_text: string | null;
  is_required: boolean;
  is_variant_defining: boolean;
  sort_order: number;
}

/** "empty" = la persona aún no lo llenó (no se envía al servidor). */
export interface AttrValue {
  state: AttrState | "empty";
  text: string;
  number: string;
  options: string[];
  unitId: string | null;
}

export interface UnitLite {
  id: string;
  code: string;
  name_singular: string;
  name_plural: string;
  symbol: string | null;
  kind: "inventory" | "measure";
  allows_decimal: boolean;
}

export interface CountInput {
  pending: boolean;
  quantity: string;
  full: string;
  loose: string;
}

export interface AttrPayload {
  attribute_id: string;
  state: AttrState;
  text?: string | undefined;
  number?: number | undefined;
  options?: string[] | undefined;
  unit_id?: string | null | undefined;
}

/** Especificaciones físicas que se piden en todos los tipos (sección propia en Capturar). */
export const SPEC_ATTR_CODES = [
  "tipo_empaque",
  "peso",
  "medida_largo",
  "medida_ancho",
  "medida_alto",
] as const;
const WEIGHT_UNIT_CODES = new Set(["g", "kg"]);

/** Unidades que tienen sentido para un atributo numérico: peso con peso, medidas con longitud. */
export function compatibleUnits(
  def: Pick<AttrDef, "default_unit_id">,
  measureUnits: UnitLite[],
): UnitLite[] {
  const base = measureUnits.find((u) => u.id === def.default_unit_id);
  const weight = !!base && WEIGHT_UNIT_CODES.has(base.code);
  return measureUnits.filter((u) => WEIGHT_UNIT_CODES.has(u.code) === weight);
}

export function emptyAttr(def: Pick<AttrDef, "default_unit_id">): AttrValue {
  return { state: "empty", text: "", number: "", options: [], unitId: def.default_unit_id };
}

export function emptyCount(): CountInput {
  return { pending: false, quantity: "", full: "", loose: "" };
}

/** Convierte "35,5" o "35.5" a número; null si está vacío o no es número. */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function isFilled(def: AttrDef, v: AttrValue | undefined): boolean {
  if (!v) return false;
  if (def.data_type === "number") return v.number.trim() !== "";
  if (def.data_type === "multiselect") return v.options.length > 0;
  return v.text.trim() !== "";
}

/** Estado efectivo: si escribió algo es valor real; si marcó un estado, ese. */
export function effectiveState(def: AttrDef, v: AttrValue | undefined): AttrValue["state"] {
  if (!v) return "empty";
  if (v.state === "not_applicable" || v.state === "pending") return v.state;
  return isFilled(def, v) ? "value" : "empty";
}

export function validateAttr(
  def: AttrDef,
  v: AttrValue | undefined,
  confirming: boolean,
): string | null {
  const state = effectiveState(def, v);
  if (state === "empty") {
    return def.is_required && confirming
      ? "Obligatorio: escribe el valor o marca «Dato pendiente» o «No aplica»."
      : null;
  }
  if (state !== "value" || !v) return null;
  if (def.data_type === "number") {
    const n = parseNumber(v.number);
    if (n === null) return "Escribe un número válido";
    if (n < 0) return "No puede ser negativo";
  }
  if (
    def.data_type === "select" &&
    def.options.length > 0 &&
    !def.options.includes(v.text.trim())
  ) {
    return "Elige una opción de la lista";
  }
  if (def.data_type === "text" && v.text.trim().length > 300) return "Máximo 300 caracteres";
  return null;
}

export function attrToPayload(def: AttrDef, v: AttrValue | undefined): AttrPayload | null {
  const state = effectiveState(def, v);
  if (state === "empty" || !v) return null;
  if (state !== "value") return { attribute_id: def.id, state };
  if (def.data_type === "number")
    return {
      attribute_id: def.id,
      state,
      number: parseNumber(v.number) ?? undefined,
      unit_id: v.unitId,
    };
  if (def.data_type === "multiselect") return { attribute_id: def.id, state, options: v.options };
  return { attribute_id: def.id, state, text: v.text.trim() };
}

/** Texto corto de un atributo: "25 mm", "Rojo", "No aplica". */
export function attrDisplay(
  def: AttrDef,
  v: AttrValue | undefined,
  units: UnitLite[],
): string | null {
  const state = effectiveState(def, v);
  if (state !== "value" || !v) return null;
  if (def.data_type === "number") {
    const n = parseNumber(v.number);
    const unit = units.find((u) => u.id === v.unitId);
    return `${n}${unit ? ` ${unit.symbol ?? unit.name_plural}` : ""}`;
  }
  if (def.data_type === "multiselect") return v.options.join(", ");
  return v.text.trim();
}

/** Nombre de la variante a partir de sus atributos definitorios. */
export function buildVariantLabel(
  defs: AttrDef[],
  attrs: Record<string, AttrValue>,
  units: UnitLite[],
): string {
  return defs
    .filter((d) => d.is_variant_defining)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => attrDisplay(d, attrs[d.id], units))
    .filter((s): s is string => !!s)
    .join(" · ");
}

export type CountResult =
  | { ok: true; pending: true }
  | {
      ok: true;
      pending: false;
      total: number;
      full: number | null;
      loose: number | null;
      quantity: number | null;
    }
  | { ok: false; error: string };

/**
 * Cantidad contada en la unidad base. Con factor conocido se permite
 * «presentaciones completas + sueltos» (2 rollos de 20 m + 5 m = 45 m).
 * Sin factor no se inventa la conversión: solo se acepta el total.
 */
export function computeCount(
  count: CountInput,
  factor: number | null,
  allowsDecimal: boolean,
): CountResult {
  if (count.pending) return { ok: true, pending: true };
  const usesPresentations = count.full.trim() !== "" || count.loose.trim() !== "";
  if (usesPresentations) {
    if (!factor || factor <= 0)
      return {
        ok: false,
        error:
          "Se desconoce el contenido de cada presentación: captura el total en la unidad base.",
      };
    const full = count.full.trim() === "" ? 0 : parseNumber(count.full);
    const loose = count.loose.trim() === "" ? 0 : parseNumber(count.loose);
    if (full === null || loose === null) return { ok: false, error: "Escribe números válidos" };
    if (full < 0 || loose < 0) return { ok: false, error: "La cantidad no puede ser negativa" };
    if (!Number.isInteger(full))
      return { ok: false, error: "Las presentaciones completas deben ser un número entero" };
    if (!allowsDecimal && !Number.isInteger(loose))
      return { ok: false, error: "Esta unidad solo admite cantidades enteras" };
    const total = Math.round((full * factor + loose) * 1000) / 1000;
    if (!allowsDecimal && !Number.isInteger(total))
      return { ok: false, error: "El total debe ser entero para esta unidad" };
    return {
      ok: true,
      pending: false,
      total,
      full: count.full.trim() === "" ? null : full,
      loose: count.loose.trim() === "" ? null : loose,
      quantity: null,
    };
  }
  if (count.quantity.trim() === "")
    return {
      ok: false,
      error: "Escribe la cantidad contada (0 si no hay) o marca «Pendiente de conteo».",
    };
  const q = parseNumber(count.quantity);
  if (q === null) return { ok: false, error: "Escribe un número válido" };
  if (q < 0) return { ok: false, error: "La cantidad no puede ser negativa" };
  if (!allowsDecimal && !Number.isInteger(q))
    return { ok: false, error: "Esta unidad solo admite cantidades enteras" };
  return { ok: true, pending: false, total: q, full: null, loose: null, quantity: q };
}

/** Índices de filas cuya firma (atributos definitorios completos) se repite en el mismo lote. */
export function duplicateIndexes(signatures: Array<string | null | undefined>): Set<number> {
  const seen = new Map<string, number>();
  const dups = new Set<number>();
  signatures.forEach((sig, i) => {
    if (!sig) return;
    const first = seen.get(sig);
    if (first === undefined) seen.set(sig, i);
    else {
      dups.add(first);
      dups.add(i);
    }
  });
  return dups;
}

/** Combinaciones de dos ejes (colores × medidas). Solo se crean las marcadas. */
export function combinationKeys(a: string[], b: string[]): Array<[string, string | null]> {
  const bb = b.length > 0 ? b : [null];
  const out: Array<[string, string | null]> = [];
  for (const x of a) for (const y of bb) out.push([x, y]);
  return out;
}

export function comboKey(a: string, b: string | null): string {
  return `${a}\u0000${b ?? ""}`;
}

/** Etiquetas de uso: "escolar, moños , escolar" → ["escolar", "moños"]. */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const t = part.trim().slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

export function newKey(): string {
  return crypto.randomUUID();
}

/** Valor comparable de un atributo (sin mayúsculas ni acentos); null si no es un valor real. */
export function comparableValue(
  dataType: AttrDataType,
  v: {
    state: string;
    text?: string | null;
    number?: string | number | null;
    options?: string[] | null;
    unitId?: string | null;
  },
): string | null {
  if (v.state !== "value") return null;
  const norm = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  if (dataType === "number") {
    const n = typeof v.number === "number" ? v.number : parseNumber(String(v.number ?? ""));
    return n === null ? null : `${n}|${v.unitId ?? ""}`;
  }
  if (dataType === "multiselect") {
    const opts = (v.options ?? []).map(norm).filter(Boolean).sort();
    return opts.length ? opts.join(",") : null;
  }
  const t = norm(v.text ?? "");
  return t || null;
}

/**
 * Posible duplicado: todos los atributos que ambos tienen capturados coinciden
 * y la fila tiene al menos uno. Solo avisa; el bloqueo es para combinaciones completas.
 */
export function isPossibleDuplicate(
  row: Record<string, string | null>,
  other: Record<string, string | null>,
): boolean {
  let shared = 0;
  for (const [id, value] of Object.entries(row)) {
    const o = other[id] ?? null;
    if (value === null || o === null) continue;
    if (value !== o) return false;
    shared++;
  }
  return shared > 0;
}
