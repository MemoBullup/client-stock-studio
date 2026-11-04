import { describe, expect, it } from "vitest";

import type { AttrDef, UnitLite } from "@/lib/capture";
import { findTreePath, parseAttrCell, parseImport, parseQuantity, stableUuid } from "@/lib/importer";

const units: UnitLite[] = [
  { id: "u-m", code: "m", name_singular: "metro", name_plural: "metros", symbol: "m", kind: "inventory", allows_decimal: true },
  { id: "u-pz", code: "pz", name_singular: "pieza", name_plural: "piezas", symbol: "pz", kind: "inventory", allows_decimal: false },
  { id: "u-mm", code: "mm", name_singular: "milímetro", name_plural: "milímetros", symbol: "mm", kind: "measure", allows_decimal: true },
  { id: "u-cm", code: "cm", name_singular: "centímetro", name_plural: "centímetros", symbol: "cm", kind: "measure", allows_decimal: true },
];

const color: AttrDef = {
  id: "a-color", code: "color", name: "Color", data_type: "select", options: ["Rojo", "Azul marino"],
  default_unit_id: null, help_text: null, is_required: true, is_variant_defining: true, sort_order: 1,
};
const ancho: AttrDef = {
  id: "a-ancho", code: "ancho", name: "Ancho", data_type: "number", options: [],
  default_unit_id: "u-mm", help_text: null, is_required: true, is_variant_defining: true, sort_order: 2,
};
const locations = [
  { id: "l-bod", parent_id: null, name: "Bodega" },
  { id: "l-a", parent_id: "l-bod", name: "Anaquel A" },
  { id: "l-tienda", parent_id: null, name: "Tienda" },
  { id: "l-a2", parent_id: "l-tienda", name: "Anaquel A" },
];
const ctx = {
  typeId: "t-liston", defaultUnitId: "u-m", defs: [color, ancho], units,
  categories: [{ id: "c-lis", parent_id: null, name: "Listones" }], locations, confirming: true,
};

describe("cantidades del archivo", () => {
  it("vacío o «pendiente» queda pendiente de conteo, 0 es un conteo en cero", () => {
    expect(parseQuantity("")).toEqual({ pending: true });
    expect(parseQuantity("Pendiente")).toEqual({ pending: true });
    expect(parseQuantity("0")).toEqual({ value: 0 });
    expect(parseQuantity("12,5")).toEqual({ value: 12.5 });
    expect(parseQuantity("-3")).toHaveProperty("error");
  });
});

describe("ubicaciones por ruta", () => {
  it("un nombre repetido en dos ramas exige la ruta completa", () => {
    expect(findTreePath("Anaquel A", locations)).toHaveProperty("error");
    expect(findTreePath("Tienda > Anaquel A", locations)).toEqual({ id: "l-a2" });
    expect(findTreePath("bodega › anaquel a", locations)).toEqual({ id: "l-a" });
  });
});

describe("valores de características", () => {
  it("acepta la opción sin importar mayúsculas ni acentos y rechaza las que no están en la lista", () => {
    expect(parseAttrCell(color, "azul MARINO", units, null)).toMatchObject({ payload: { text: "Azul marino" } });
    expect(parseAttrCell(color, "Verde", units, null)).toHaveProperty("error");
  });
  it("lee la unidad escrita junto al número o usa la del encabezado", () => {
    expect(parseAttrCell(ancho, "2.5 cm", units, null)).toMatchObject({ payload: { number: 2.5, unit_id: "u-cm" } });
    expect(parseAttrCell(ancho, "25", units, "mm")).toMatchObject({ payload: { number: 25, unit_id: "u-mm" } });
    expect(parseAttrCell(ancho, "no aplica", units, null)).toMatchObject({ payload: { state: "not_applicable" } });
  });
});

describe("importación de filas", () => {
  const header = ["Producto *", "Color *", "Ancho (mm) *", "Cantidad", "Ubicación"];

  it("agrupa las filas del mismo producto como variantes", () => {
    const r = parseImport(
      [header, ["Listón satinado", "Rojo", "25", "45", "Bodega > Anaquel A"], ["listón satinado", "Azul marino", "25", "", ""]],
      ctx,
    );
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.variants).toHaveLength(2);
    expect(r.groups[0]!.variants[0]!.count).toEqual({ location_id: "l-a", quantity: 45 });
    expect(r.groups[0]!.variants[1]!.count).toEqual({ pending: true });
    expect(r.groups[0]!.variants.every((v) => v.errors.length === 0)).toBe(true);
  });

  it("una cantidad sin ubicación es un error de la fila", () => {
    const r = parseImport([header, ["Listón", "Rojo", "25", "10", ""]], ctx);
    expect(r.groups[0]!.variants[0]!.errors.join(" ")).toMatch(/ubicación/i);
  });

  it("marca la misma combinación repetida dentro del mismo producto", () => {
    const r = parseImport([header, ["Listón", "Rojo", "25", "", ""], ["Listón", "rojo", "25 mm", "", ""]], ctx);
    expect(r.groups[0]!.variants[1]!.errors.join(" ")).toMatch(/fila 2/);
  });

  it("al confirmar exige las características obligatorias; como borrador no", () => {
    const rows = [["Producto", "Ancho (mm)"], ["Listón", "25"]];
    expect(parseImport(rows, ctx).groups[0]!.variants[0]!.errors.join(" ")).toMatch(/Color/);
    expect(parseImport(rows, { ...ctx, confirming: false }).groups[0]!.variants[0]!.errors).toEqual([]);
  });

  it("sin columna Producto no se importa nada", () => {
    expect(parseImport([["Color"], ["Rojo"]], ctx).fileErrors).toHaveLength(1);
  });
});

describe("claves de reintento", () => {
  it("el mismo contenido produce la misma clave y otro contenido una distinta", async () => {
    const a = await stableUuid("Listón|Rojo|25");
    expect(a).toBe(await stableUuid("Listón|Rojo|25"));
    expect(a).not.toBe(await stableUuid("Listón|Azul|25"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
