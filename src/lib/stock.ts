// Reglas de existencias mínimas. La base de datos aplica las mismas reglas
// (list_stock_minimums / low_stock_summary); aquí se usan para mostrar estados.

export type MinimumState = "below" | "ok" | "pending";

/**
 * - "pending": todavía no se cuenta en esa ubicación (no es alerta).
 * - "below": se contó y la cantidad es MENOR al mínimo.
 * - "ok": la cantidad es igual o mayor al mínimo.
 */
export function minimumState(quantity: number | null | undefined, minimum: number): MinimumState {
  if (quantity === null || quantity === undefined) return "pending";
  return quantity < minimum ? "below" : "ok";
}

/** Cuánto falta para llegar al mínimo (0 si no falta nada o no se ha contado). */
export function shortfall(quantity: number | null | undefined, minimum: number): number {
  if (quantity === null || quantity === undefined) return 0;
  return Math.max(0, Math.round((minimum - quantity) * 1000) / 1000);
}

/** Valida el mínimo capturado según la unidad base del SKU. */
export function parseMinimum(
  raw: string,
  allowsDecimal: boolean,
): { ok: true; value: number } | { ok: false; error: string } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { ok: false, error: "Escribe el mínimo" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: "Escribe un número válido" };
  if (value < 0) return { ok: false, error: "El mínimo no puede ser negativo" };
  if (!allowsDecimal && !Number.isInteger(value))
    return { ok: false, error: "Esta unidad solo admite cantidades enteras" };
  return { ok: true, value };
}
