import { describe, expect, it } from "vitest";

import { buildTree, pathOf, subtreeHeight, validMoveTargets, type TreeItem } from "./tree";

const item = (id: string, parent_id: string | null, depth: number, name = id): TreeItem => ({
  id,
  parent_id,
  name,
  depth,
  sort_order: 0,
  is_active: true,
});

// Listones > Textiles > Estampados > Escolares ; Aplicaciones
const items = [
  item("lis", null, 1, "Listones"),
  item("tex", "lis", 2, "Textiles"),
  item("est", "tex", 3, "Estampados"),
  item("esc", "est", 4, "Escolares"),
  item("apl", null, 1, "Aplicaciones"),
];

describe("árbol de categorías", () => {
  it("arma la ruta completa de una categoría", () => {
    expect(pathOf(items, "esc", " > ")).toBe("Listones > Textiles > Estampados > Escolares");
  });

  it("no ofrece mover una categoría dentro de sí misma ni de sus descendientes (evita ciclos)", () => {
    const targets = validMoveTargets(items, "tex", 4).map((t) => t?.id ?? "raiz");
    expect(targets).not.toContain("tex");
    expect(targets).not.toContain("est");
    expect(targets).not.toContain("esc");
  });

  it("no permite superar 4 niveles al mover", () => {
    // "tex" tiene 3 niveles de alto: solo cabe en la raíz o directamente bajo una categoría de nivel 1
    expect(subtreeHeight(items, "tex")).toBe(3);
    const targets = validMoveTargets(items, "tex", 4).map((t) => t?.id ?? "raiz");
    expect(targets.sort()).toEqual(["apl", "lis", "raiz"].sort());
  });

  it("permite clasificaciones de menos de cuatro niveles", () => {
    const tree = buildTree(items);
    const aplicaciones = tree.find((n) => n.item.id === "apl");
    expect(aplicaciones?.children).toHaveLength(0);
  });
});
