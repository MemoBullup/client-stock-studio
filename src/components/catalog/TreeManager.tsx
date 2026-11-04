import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CornerDownRight,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { normalizeText } from "@/lib/format";
import {
  buildTree,
  descendantIds,
  flattenTree,
  pathOf,
  sortItems,
  validMoveTargets,
  type TreeItem,
  type TreeNode,
} from "@/lib/tree";
import { cn } from "@/lib/utils";

type Kind = "categories" | "locations";

interface Row extends TreeItem {
  code?: string | null;
  description: string | null;
  is_demo: boolean;
}

const LABELS: Record<
  Kind,
  { singular: string; plural: string; child: string; root: string; count: (n: number) => string }
> = {
  categories: {
    singular: "categoría",
    plural: "categorías",
    child: "subcategoría",
    root: "Nueva categoría principal",
    count: (n) => `${n} producto${n === 1 ? "" : "s"}`,
  },
  locations: {
    singular: "ubicación",
    plural: "ubicaciones",
    child: "ubicación dentro",
    root: "Nueva ubicación principal",
    count: (n) => `${n} SKU con existencia`,
  },
};

type DialogState =
  | { type: "create"; parentId: string | null }
  | { type: "edit"; item: Row }
  | { type: "move"; item: Row }
  | { type: "delete"; item: Row }
  | null;

const ROOT = "__root";
const NONE = "__none";

export function TreeManager({ kind, maxDepth }: { kind: Kind; maxDepth: number }) {
  const L = LABELS[kind];
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);

  const itemsQuery = useQuery({
    queryKey: ["tree", kind],
    queryFn: async (): Promise<Row[]> => {
      const res =
        kind === "categories"
          ? await supabase
              .from("categories")
              .select("id, parent_id, name, sort_order, depth, is_active, description, is_demo")
          : await supabase
              .from("locations")
              .select(
                "id, parent_id, name, code, sort_order, depth, is_active, description, is_demo",
              );
      if (res.error) throw res.error;
      return (res.data ?? []) as Row[];
    },
  });

  const countsQuery = useQuery({
    queryKey: ["tree-counts", kind],
    queryFn: async () => {
      const map = new Map<string, number>();
      if (kind === "categories") {
        const { data, error } = await supabase.rpc("category_product_counts");
        if (error) throw error;
        for (const r of data ?? [])
          if (r.category_id) map.set(r.category_id, Number(r.product_count));
      } else {
        const { data, error } = await supabase.rpc("location_stock_counts");
        if (error) throw error;
        for (const r of data ?? []) if (r.location_id) map.set(r.location_id, Number(r.sku_count));
      }
      return map;
    },
  });

  const items = itemsQuery.data ?? [];
  const counts = countsQuery.data ?? new Map<string, number>();

  const visibleIds = useMemo(() => {
    const base = showInactive ? items : items.filter((i) => i.is_active);
    const q = normalizeText(query);
    if (!q) return new Set(base.map((i) => i.id));
    const byId = new Map(items.map((i) => [i.id, i]));
    const set = new Set<string>();
    for (const i of base) {
      if (normalizeText(i.name).includes(q) || (i.code && normalizeText(i.code).includes(q))) {
        let cursor: Row | undefined = i;
        while (cursor && !set.has(cursor.id)) {
          set.add(cursor.id);
          cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
        }
      }
    }
    return set;
  }, [items, query, showInactive]);

  const tree = useMemo(
    () => buildTree(items.filter((i) => visibleIds.has(i.id))),
    [items, visibleIds],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tree", kind] });
    qc.invalidateQueries({ queryKey: ["tree-counts", kind] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const table = () => supabase.from(kind as "locations");

  const toggleActive = useMutation({
    mutationFn: async (item: Row) => {
      const { error } = await table().update({ is_active: !item.is_active }).eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: (_d, item) => {
      toast.success(item.is_active ? `Se desactivó «${item.name}»` : `Se activó «${item.name}»`);
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const reorder = useMutation({
    mutationFn: async ({ item, dir }: { item: Row; dir: -1 | 1 }) => {
      const siblings = items.filter((i) => i.parent_id === item.parent_id).sort(sortItems);
      const idx = siblings.findIndex((s) => s.id === item.id);
      const swap = idx + dir;
      if (swap < 0 || swap >= siblings.length) return;
      const next = siblings.slice();
      const a = next[idx]!;
      next[idx] = next[swap]!;
      next[swap] = a;
      const updates = next
        .map((s, i) => ({ id: s.id, sort_order: (i + 1) * 10, prev: s.sort_order }))
        .filter((u) => u.sort_order !== u.prev);
      for (const u of updates) {
        const { error } = await table().update({ sort_order: u.sort_order }).eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNodes = (nodes: TreeNode<Row>[]) => (
    <ul className="grid gap-1" role="group">
      {nodes.map((node) => {
        const { item } = node;
        const hasChildren = node.children.length > 0;
        const isOpen = !collapsed.has(item.id) || !!query;
        const siblings = items.filter((i) => i.parent_id === item.parent_id).sort(sortItems);
        const pos = siblings.findIndex((s) => s.id === item.id);
        const count = counts.get(item.id) ?? 0;
        return (
          <li
            key={item.id}
            role="treeitem"
            aria-expanded={hasChildren ? isOpen : undefined}
            aria-level={item.depth}
          >
            <div
              className={cn(
                "group flex flex-wrap items-center gap-2 rounded-2xl border border-transparent px-2 py-2 transition-colors hover:border-border hover:bg-muted/60",
                !item.is_active && "opacity-60",
              )}
              style={{ paddingLeft: `${(item.depth - 1) * 1.25 + 0.5}rem` }}
            >
              <button
                type="button"
                onClick={() => hasChildren && toggleCollapse(item.id)}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  hasChildren ? "hover:bg-accent" : "cursor-default",
                )}
                aria-label={
                  hasChildren
                    ? isOpen
                      ? `Contraer ${item.name}`
                      : `Expandir ${item.name}`
                    : undefined
                }
                tabIndex={hasChildren ? 0 : -1}
              >
                {hasChildren ? (
                  <ChevronRight
                    className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                  />
                ) : (
                  <CornerDownRight className="size-3.5 text-muted-foreground" aria-hidden />
                )}
              </button>
              <span className="font-semibold">{item.name}</span>
              {item.code && (
                <span className="text-xs font-mono text-muted-foreground">{item.code}</span>
              )}
              <Badge variant="muted">Nivel {item.depth}</Badge>
              {!item.is_active && <Badge variant="warning">Inactiva</Badge>}
              {item.is_demo && <Badge variant="demo">DEMO</Badge>}
              <div className="ml-auto flex items-center gap-1">
                {count > 0 && <Badge variant="info">{L.count(count)}</Badge>}
                {item.depth < maxDepth && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDialog({ type: "create", parentId: item.id })}
                    aria-label={`Agregar ${L.child} de ${item.name}`}
                    title={`Agregar ${L.child}`}
                  >
                    <Plus />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Acciones para ${item.name}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                    <DropdownMenuItem onSelect={() => setDialog({ type: "edit", item })}>
                      <Pencil /> Renombrar o editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog({ type: "move", item })}>
                      <MoveRight /> Mover a…
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={pos <= 0}
                      onSelect={() => reorder.mutate({ item, dir: -1 })}
                    >
                      <ArrowUp /> Subir
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={pos === siblings.length - 1}
                      onSelect={() => reorder.mutate({ item, dir: 1 })}
                    >
                      <ArrowDown /> Bajar
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => toggleActive.mutate(item)}>
                      {item.is_active ? <EyeOff /> : <Eye />}{" "}
                      {item.is_active ? "Desactivar" : "Activar"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDialog({ type: "delete", item })}
                    >
                      <Trash2 /> Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {hasChildren && isOpen && renderNodes(node.children)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="surface-card p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${L.plural}…`}
            aria-label={`Buscar ${L.plural}`}
            className="h-11 rounded-full pl-10"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Mostrar inactivas
        </label>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())}>
            Expandir todo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCollapsed(
                new Set(
                  items.filter((i) => items.some((c) => c.parent_id === i.id)).map((i) => i.id),
                ),
              )
            }
          >
            Contraer
          </Button>
        </div>
        <Button onClick={() => setDialog({ type: "create", parentId: null })}>
          <Plus /> {L.root}
        </Button>
      </div>

      {kind === "categories" && (
        <p className="mt-4 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-foreground">
          Hasta {maxDepth} niveles. No es obligatorio completarlos todos. Los productos sin
          categoría quedan como <strong>«Por clasificar»</strong> y pendientes de revisión. Colores,
          medidas y acabados se registran como atributos, no como categorías.
        </p>
      )}

      <div className="mt-5" role="tree" aria-label={`Árbol de ${L.plural}`}>
        {itemsQuery.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Cargando {L.plural}…
          </div>
        ) : itemsQuery.isError ? (
          <div role="alert" className="rounded-2xl bg-destructive/10 p-5 text-sm text-destructive">
            No se pudieron cargar las {L.plural}. {friendlyError(itemsQuery.error)}
            <Button
              variant="outline"
              size="sm"
              className="ml-3"
              onClick={() => itemsQuery.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : tree.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {query
              ? `Ninguna ${L.singular} coincide con «${query}».`
              : `Aún no hay ${L.plural}. Crea la primera con el botón «${L.root}».`}
          </div>
        ) : (
          renderNodes(tree)
        )}
      </div>

      {dialog?.type === "create" || dialog?.type === "edit" ? (
        <EditDialog
          kind={kind}
          state={dialog}
          items={items}
          onClose={() => setDialog(null)}
          onSaved={invalidate}
        />
      ) : null}
      {dialog?.type === "move" && (
        <MoveDialog
          kind={kind}
          item={dialog.item}
          items={items}
          maxDepth={maxDepth}
          onClose={() => setDialog(null)}
          onSaved={invalidate}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteDialog
          kind={kind}
          item={dialog.item}
          items={items}
          count={counts.get(dialog.item.id) ?? 0}
          onClose={() => setDialog(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function EditDialog({
  kind,
  state,
  items,
  onClose,
  onSaved,
}: {
  kind: Kind;
  state: { type: "create"; parentId: string | null } | { type: "edit"; item: Row };
  items: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = LABELS[kind];
  const editing = state.type === "edit" ? state.item : null;
  const parentId = state.type === "create" ? state.parentId : (editing?.parent_id ?? null);
  const [name, setName] = useState(editing?.name ?? "");
  const [code, setCode] = useState(editing?.code ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload: { name: string; description: string | null; code?: string | null } = {
        name: name.trim(),
        description: description.trim() || null,
      };
      if (kind === "locations") payload.code = code.trim() || null;
      const t = supabase.from(kind as "locations");
      if (editing) {
        const { error } = await t.update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const siblings = items.filter((i) => i.parent_id === parentId);
        const sort_order = (Math.max(0, ...siblings.map((s) => s.sort_order)) || 0) + 10;
        const { error } = await t.insert({ ...payload, parent_id: parentId, sort_order });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cambios guardados" : `Se creó «${name.trim()}»`);
      onSaved();
      onClose();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError("Escribe un nombre.");
    if (n.length > 80) return setError("Máximo 80 caracteres.");
    setError(null);
    save.mutate();
  }

  const parentPath = parentId ? pathOf(items, parentId) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Editar ${L.singular}` : parentId ? `Nueva ${L.child}` : L.root}
            </DialogTitle>
            <DialogDescription>
              {parentPath ? (
                <>
                  Dentro de: <strong>{parentPath}</strong>
                </>
              ) : (
                "Nivel principal"
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tree-name">Nombre</Label>
            <Input
              id="tree-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={80}
              aria-invalid={!!error}
              aria-describedby={error ? "tree-error" : undefined}
            />
          </div>
          {kind === "locations" && (
            <div className="grid gap-2">
              <Label htmlFor="tree-code">Código corto (opcional)</Label>
              <Input
                id="tree-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={30}
                placeholder="Ej. E03"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="tree-desc">Descripción (opcional)</Label>
            <Textarea
              id="tree-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={2}
            />
          </div>
          {error && (
            <p id="tree-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  kind,
  item,
  items,
  maxDepth,
  onClose,
  onSaved,
}: {
  kind: Kind;
  item: Row;
  items: Row[];
  maxDepth: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = LABELS[kind];
  const targets = useMemo(() => {
    const flat = flattenTree(buildTree(items));
    const valid = new Set(validMoveTargets(items, item.id, maxDepth).map((t) => (t ? t.id : ROOT)));
    return [
      ...(valid.has(ROOT) && item.parent_id !== null
        ? [{ value: ROOT, label: "Nivel principal (raíz)" }]
        : []),
      ...flat
        .filter((t) => valid.has(t.id) && t.id !== item.parent_id)
        .map((t) => ({ value: t.id, label: pathOf(items, t.id) })),
    ];
  }, [items, item, maxDepth]);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const parent_id = target === ROOT ? null : target;
      const siblings = items.filter((i) => i.parent_id === parent_id);
      const sort_order = (Math.max(0, ...siblings.map((s) => s.sort_order)) || 0) + 10;
      const { error } = await supabase
        .from(kind as "locations")
        .update({ parent_id, sort_order })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Se movió «${item.name}»`);
      onSaved();
      onClose();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Mover «{item.name}»</DialogTitle>
          <DialogDescription>
            Ubicación actual: <strong>{pathOf(items, item.id)}</strong>. Se mueve junto con todo su
            contenido. Solo se muestran destinos que no generan ciclos ni superan {maxDepth}{" "}
            niveles.
          </DialogDescription>
        </DialogHeader>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay destinos válidos para esta {L.singular}.
          </p>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="move-target">Nuevo destino</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="move-target" className="rounded-2xl">
                <SelectValue placeholder="Elige el destino" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {targets.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!target || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  kind,
  item,
  items,
  count,
  onClose,
  onSaved,
}: {
  kind: Kind;
  item: Row;
  items: Row[];
  count: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = LABELS[kind];
  const childCount = descendantIds(items, item.id).size;
  const needsReassign = kind === "categories" && count > 0;
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () =>
      flattenTree(buildTree(items))
        .filter((c) => c.id !== item.id && c.is_active)
        .map((c) => ({ value: c.id, label: pathOf(items, c.id) })),
    [items, item.id],
  );

  const remove = useMutation({
    mutationFn: async () => {
      if (kind === "categories") {
        const args: { _id: string; _reassign: boolean; _reassign_to?: string } = {
          _id: item.id,
          _reassign: needsReassign,
        };
        if (needsReassign && target !== NONE) args._reassign_to = target;
        const { error } = await supabase.rpc("delete_category", args);
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("delete_location", { _id: item.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`Se eliminó «${item.name}»`);
      onSaved();
      onClose();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Eliminar «{item.name}»</DialogTitle>
          <DialogDescription>{pathOf(items, item.id)}</DialogDescription>
        </DialogHeader>
        {childCount > 0 ? (
          <p className="rounded-2xl bg-warning-soft p-4 text-sm text-warning-foreground">
            Contiene {childCount} {childCount === 1 ? L.singular : L.plural} dentro. Muévelas o
            elimínalas primero.
          </p>
        ) : needsReassign ? (
          <div className="grid gap-3">
            <p className="rounded-2xl bg-warning-soft p-4 text-sm text-warning-foreground">
              Tiene {L.count(count)}. Elige a dónde reasignarlos antes de eliminarla. Su SKU, QR y
              fotografías no cambian.
            </p>
            <Label htmlFor="reassign">Reasignar productos a</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="reassign" className="rounded-2xl">
                <SelectValue placeholder="Elige una categoría" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value={NONE}>Por clasificar (pendiente de revisión)</SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Esta acción no se puede deshacer. Si solo quieres ocultarla, usa «Desactivar».
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={childCount > 0 || (needsReassign && !target) || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Loader2 className="animate-spin" />} Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
