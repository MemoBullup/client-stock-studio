import { describe, expect, it } from "vitest";

import { minimumState, parseMinimum, shortfall } from "./stock";

describe("alertas de existencias mínimas", () => {
  it("alerta cuando la existencia contada está por debajo del mínimo", () => {
    expect(minimumState(3.5, 10)).toBe("below");
    expect(shortfall(3.5, 10)).toBe(6.5);
  });

  it("no alerta cuando la existencia es igual al mínimo", () => {
    expect(minimumState(5, 5)).toBe("ok");
    expect(shortfall(5, 5)).toBe(0);
  });

  it("un SKU sin conteo queda pendiente, no en alerta", () => {
    expect(minimumState(null, 5)).toBe("pending");
  });

  it("cero contado con mínimo mayor a cero sí es alerta", () => {
    expect(minimumState(0, 1)).toBe("below");
  });

  it("no acepta fracciones en unidades enteras ni mínimos negativos", () => {
    expect(parseMinimum("2.5", false).ok).toBe(false);
    expect(parseMinimum("-1", true).ok).toBe(false);
    expect(parseMinimum("2,5", true)).toEqual({ ok: true, value: 2.5 });
  });
});

import { computeAdjustment } from "./stock";

describe("ajustes de inventario", () => {
  it("fijar total reemplaza la cantidad", () => {
    expect(computeAdjustment(35.5, "set", 30)).toEqual({ ok: true, value: 30 });
  });
  it("sumar y restar parten de la existencia actual", () => {
    expect(computeAdjustment(35.5, "increase", 3)).toEqual({ ok: true, value: 38.5 });
    expect(computeAdjustment(12, "decrease", 4)).toEqual({ ok: true, value: 8 });
  });
  it("no permite dejar existencias negativas", () => {
    expect(computeAdjustment(2, "decrease", 5).ok).toBe(false);
  });
  it("no ajusta un SKU pendiente de conteo", () => {
    expect(computeAdjustment(null, "increase", 1).ok).toBe(false);
  });
});
