import { describe, expect, it } from "vitest";

import {
  buildVariantLabel,
  combinationKeys,
  computeCount,
  duplicateIndexes,
  emptyCount,
  parseTags,
  validateAttr,
  type AttrDef,
  type UnitLite,
} from "./capture";

const ancho: AttrDef = {
  id: "a1",
  code: "ancho",
  name: "Ancho",
  data_type: "number",
  options: [],
  default_unit_id: "mm",
  help_text: null,
  is_required: true,
  is_variant_defining: true,
  sort_order: 2,
};
const color: AttrDef = { ...ancho, id: "c1", code: "color_principal", name: "Color", data_type: "select", options: ["Rojo", "Azul"], sort_order: 1 };
const units: UnitLite[] = [
  { id: "mm", code: "mm", name_singular: "milímetro", name_plural: "milímetros", symbol: "mm", kind: "measure", allows_decimal: true },
];

describe("conteo con presentaciones", () => {
  it("2 rollos de 20 metros + 5 metros sueltos = 45 metros", () => {
    const r = computeCount({ ...emptyCount(), full: "2", loose: "5" }, 20, true);
    expect(r).toMatchObject({ ok: true, pending: false, total: 45 });
  });

  it("sin factor conocido no se convierte rollos a metros", () => {
    const r = computeCount({ ...emptyCount(), full: "2" }, null, true);
    expect(r.ok).toBe(false);
  });

  it("pendiente de conteo es distinto de cero", () => {
    expect(computeCount({ ...emptyCount(), pending: true }, null, true)).toEqual({ ok: true, pending: true });
    expect(computeCount({ ...emptyCount(), quantity: "0" }, null, true)).toMatchObject({ ok: true, pending: false, total: 0 });
  });

  it("una cantidad vacía no se toma como cero", () => {
    expect(computeCount(emptyCount(), null, true).ok).toBe(false);
  });

  it("piezas no admiten fracciones", () => {
    expect(computeCount({ ...emptyCount(), quantity: "2.5" }, null, false).ok).toBe(false);
    expect(computeCount({ ...emptyCount(), quantity: "35,5" }, null, true)).toMatchObject({ ok: true, total: 35.5 });
  });
});

describe("atributos", () => {
  it("un obligatorio vacío bloquea la confirmación pero no el borrador", () => {
    const v = { state: "empty" as const, text: "", number: "", options: [], unitId: "mm" };
    expect(validateAttr(ancho, v, true)).not.toBeNull();
    expect(validateAttr(ancho, v, false)).toBeNull();
  });

  it("«Dato pendiente» permite confirmar sin inventar la medida", () => {
    const v = { state: "pending" as const, text: "", number: "", options: [], unitId: "mm" };
    expect(validateAttr(ancho, v, true)).toBeNull();
  });

  it("el nombre de la variante sale de sus atributos definitorios", () => {
    const attrs = {
      a1: { state: "value" as const, text: "", number: "25", options: [], unitId: "mm" },
      c1: { state: "value" as const, text: "Rojo", number: "", options: [], unitId: null },
    };
    expect(buildVariantLabel([ancho, color], attrs, units)).toBe("Rojo · 25 mm");
  });
});

describe("variantes en lote", () => {
  it("detecta combinaciones repetidas dentro del mismo guardado", () => {
    expect([...duplicateIndexes(["x", null, "y", "x", null])].sort()).toEqual([0, 3]);
  });

  it("dos colores por dos anchos dan cuatro combinaciones posibles", () => {
    expect(combinationKeys(["Rojo", "Azul"], ["25", "38"])).toHaveLength(4);
    expect(combinationKeys(["Rojo"], [])).toEqual([["Rojo", null]]);
  });

  it("las etiquetas de uso no se repiten", () => {
    expect(parseTags("escolar, Moños , escolar")).toEqual(["escolar", "Moños"]);
  });
});
