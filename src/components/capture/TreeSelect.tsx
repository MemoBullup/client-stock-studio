import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { treePath } from "@/lib/catalog";
import { buildTree, flattenTree, type TreeItem } from "@/lib/tree";

const NONE = "__none";

/** Selector de un árbol (ubicaciones o categorías) con la ruta completa visible. */
export function TreeSelect({
  id,
  items,
  value,
  onChange,
  placeholder = "Elige…",
  noneLabel,
  includeInactive = false,
  ariaInvalid,
  className,
}: {
  id?: string;
  items: TreeItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /** Si se indica, aparece como primera opción (valor null). */
  noneLabel?: string;
  includeInactive?: boolean;
  ariaInvalid?: boolean;
  className?: string;
}) {
  const options = useMemo(() => {
    const visible = includeInactive ? items : items.filter((i) => i.is_active);
    return flattenTree(buildTree(visible)).map((i) => ({
      id: i.id,
      depth: i.depth,
      label: i.name,
      path: treePath(visible, i.id),
    }));
  }, [items, includeInactive]);
  const selectedPath = value ? treePath(items, value) : null;

  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} aria-invalid={ariaInvalid} className={className}>
        <SelectValue placeholder={placeholder}>
          {value ? selectedPath : (noneLabel ?? placeholder)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {!noneLabel && !value && (
          <SelectItem value={NONE} disabled>
            {placeholder}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id} textValue={o.path ?? o.label}>
            <span style={{ paddingLeft: `${Math.max(0, o.depth - 1) * 12}px` }}>{o.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
