// Utilidades para árboles editables (categorías y ubicaciones).
// El servidor vuelve a validar ciclos y profundidad; esto solo guía la interfaz.

export interface TreeItem {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  depth: number;
  is_active: boolean;
}

export interface TreeNode<T extends TreeItem> {
  item: T;
  children: TreeNode<T>[];
}

export function sortItems<T extends TreeItem>(a: T, b: T): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es");
}

export function buildTree<T extends TreeItem>(items: T[]): TreeNode<T>[] {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(items.map((i) => i.id));
  for (const item of items) {
    const key = item.parent_id && ids.has(item.parent_id) ? item.parent_id : null;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }
  const build = (parent: string | null, guard: Set<string>): TreeNode<T>[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort(sortItems)
      .filter((i) => !guard.has(i.id))
      .map((item) => {
        const next = new Set(guard).add(item.id);
        return { item, children: build(item.id, next) };
      });
  return build(null, new Set());
}

/** IDs de todos los descendientes (sin incluir el propio). */
export function descendantIds<T extends TreeItem>(items: T[], id: string): Set<string> {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const item of items) {
      if (item.parent_id === current && !result.has(item.id)) {
        result.add(item.id);
        stack.push(item.id);
      }
    }
  }
  return result;
}

/** Altura del subárbol: 1 si no tiene hijos. */
export function subtreeHeight<T extends TreeItem>(items: T[], id: string): number {
  const children = items.filter((i) => i.parent_id === id);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => subtreeHeight(items, c.id)));
}

/** "Listones > Textiles > Estampados" */
export function pathOf<T extends TreeItem>(items: T[], id: string | null, sep = " › "): string {
  if (!id) return "";
  const byId = new Map(items.map((i) => [i.id, i]));
  const parts: string[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return parts.join(sep);
}

/**
 * Destinos válidos al mover un elemento: excluye el propio elemento, sus
 * descendientes (evita ciclos) y los padres que superarían la profundidad máxima.
 * `null` representa el nivel raíz.
 */
export function validMoveTargets<T extends TreeItem>(
  items: T[],
  id: string,
  maxDepth: number,
): Array<T | null> {
  const blocked = descendantIds(items, id);
  blocked.add(id);
  const height = subtreeHeight(items, id);
  const targets: Array<T | null> = [];
  if (height <= maxDepth) targets.push(null);
  for (const item of items) {
    if (blocked.has(item.id)) continue;
    if (item.depth + height <= maxDepth) targets.push(item);
  }
  return targets;
}

/** Lista plana en orden de árbol, útil para selectores con sangría. */
export function flattenTree<T extends TreeItem>(nodes: TreeNode<T>[]): T[] {
  const out: T[] = [];
  const walk = (list: TreeNode<T>[]) => {
    for (const n of list) {
      out.push(n.item);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
