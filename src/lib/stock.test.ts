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
