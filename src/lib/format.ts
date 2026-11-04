// Formato regional de México. Moneda configurable (MXN por defecto).
export const LOCALE = "es-MX";

export function formatNumber(value: number | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxDecimals }).format(value);
}

export function formatMoney(value: number | null | undefined, currency = "MXN"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "Costo pendiente";
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "12 piezas", "1 pieza", "35.5 metros" */
export function formatQuantity(
  value: number | null | undefined,
  unit: { name_singular: string; name_plural: string; allows_decimal?: boolean },
): string {
  if (value === null || value === undefined) return "Pendiente de conteo";
  const label = value === 1 ? unit.name_singular : unit.name_plural;
  return `${formatNumber(value, unit.allows_decimal === false ? 0 : 3)} ${label}`;
}

/** Normaliza texto para búsquedas: sin mayúsculas ni acentos. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
