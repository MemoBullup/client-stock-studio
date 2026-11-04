import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TreeItem } from "@/lib/tree";
import { sortItems } from "@/lib/tree";

const NONE = "__none";

/** Selectores dependientes por nivel. null = «Por clasificar». */
export function CategoryPicker({
  items,
  value,
  onChange,
  idPrefix = "cat",
}: {
  items: TreeItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  idPrefix?: string;
}) {
  const active = useMemo(() => items.filter((i) => i.is_active), [items]);
  const chain = useMemo(() => {
    const byId = new Map(active.map((i) => [i.id, i]));
    const out: string[] = [];
    let cursor = value ? byId.get(value) : undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      out.unshift(cursor.id);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    return out;
  }, [active, value]);

  const levels: Array<{ parent: string | null; selected: string | null; options: TreeItem[] }> = [];
  let parent: string | null = null;
  for (let level = 0; level < 8; level++) {
    const options = active.filter((i) => (i.parent_id ?? null) === parent).sort(sortItems);
    if (options.length === 0) break;
    const selected = chain[level] ?? null;
    levels.push({ parent, selected, options });
    if (!selected) break;
    parent = selected;
  }

  const unclassified = value === null;

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {levels.map((lvl, i) => (
          <Select
            key={`${lvl.parent ?? "root"}-${i}`}
            value={lvl.selected ?? NONE}
            onValueChange={(v) => onChange(v === NONE ? (lvl.parent ?? null) : v)}
          >
            <SelectTrigger id={i === 0 ? `${idPrefix}-0` : undefined} aria-label={`Categoría nivel ${i + 1}`}>
              <SelectValue placeholder={i === 0 ? "Elige la categoría" : "Subcategoría (opcional)"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{i === 0 ? "Por clasificar" : "— Sin subcategoría —"}</SelectItem>
              {lvl.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox checked={unclassified} onCheckedChange={(c) => c && onChange(null)} />
        Por clasificar (quedará pendiente de revisión)
      </label>
    </div>
  );
}
