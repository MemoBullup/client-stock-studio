import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/AppShell";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { minimumsQuery, useLowStockSummary, type MinimumRow } from "@/lib/alerts";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatQuantity } from "@/lib/format";
import { useMe } from "@/lib/session";
import { minimumState, parseMinimum, shortfall } from "@/lib/stock";
import { buildTree, flattenTree, pathOf, type TreeItem } from "@/lib/tree";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/alertas")({
  head: () => ({
    meta: [
      { title: "Alertas de existencias · Aly Inventario" },
      { name: "description", content: "SKU por debajo de su nivel mínimo en cada ubicación." },
      { property: "og:title", content: "Alertas de existencias · Aly Inventario" },
      {
        property: "og:description",
        content: "SKU por debajo de su nivel mínimo en cada ubicación.",
      },
    ],
  }),
  component: AlertasPage,
});

const PAGE_SIZE = 25;

function useLocations() {
  return useQuery({
    queryKey: ["locations-lite"],
    queryFn: async (): Promise<TreeItem[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, parent_id, name, sort_order, depth, is_active");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

type DialogState =
  | { type: "create" }
  | { type: "edit"; row: MinimumRow }
  | { type: "delete"; row: MinimumRow }
  | null;

function AlertasPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const [view, setView] = useState<"alerts" | "all">("alerts");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const summary = useLowStockSummary();
  const locations = useLocations();
  const list = useQuery(
    minimumsQuery({ search, onlyAlerts: view === "alerts", page, pageSize: PAGE_SIZE }),
  );
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Alertas de existencias"
        description="Cada SKU puede tener un nivel mínimo distinto en cada ubicación. Se alerta cuando la cantidad contada queda por debajo de ese mínimo."
        actions={
          isAdmin ? (
            <Button onClick={() => setDialog({ type: "create" })}>
              <Plus /> Agregar mínimo
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          tone="alert"
          icon={AlertTriangle}
          label="Bajo mínimo"
          value={summary.data?.below}
          loading={summary.isLoading}
          active={view === "alerts"}
          onClick={() => {
            setView("alerts");
            setPage(0);
          }}
        />
        <SummaryTile
          tone="muted"
          icon={Clock}
          label="Con mínimo, pendientes de conteo"
          value={summary.data?.pending}
          loading={summary.isLoading}
        />
        <SummaryTile
          tone="sky"
          icon={CheckCircle2}
          label="Mínimos configurados"
          value={summary.data?.configured}
          loading={summary.isLoading}
          active={view === "all"}
          onClick={() => {
            setView("all");
            setPage(0);
          }}
        />
      </div>

      <section className="surface-card mt-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            className="inline-flex rounded-full bg-graphite p-1"
            role="tablist"
            aria-label="Vista"
          >
            {(
              [
                ["alerts", "Bajo mínimo"],
                ["all", "Todos los mínimos"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => {
                  setView(key);
                  setPage(0);
                }}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                  view === key
                    ? "bg-primary text-primary-foreground"
                    : "text-graphite-foreground hover:bg-graphite-soft",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por SKU, nombre o variante…"
              aria-label="Buscar mínimos"
              className="h-11 rounded-full pl-10"
            />
          </div>
        </div>

        <div className="mt-5 grid gap-2">
          {list.isLoading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          ) : list.isError ? (
            <div
              role="alert"
              className="rounded-2xl bg-destructive/10 p-5 text-sm text-destructive"
            >
              No se pudieron cargar las alertas. {friendlyError(list.error)}
              <Button variant="outline" size="sm" className="ml-3" onClick={() => list.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <EmptyState
              view={view}
              search={search}
              isAdmin={isAdmin}
              configured={summary.data?.configured ?? 0}
            />
          ) : (
            list.data!.rows.map((row) => (
              <MinimumCard
                key={`${row.variant_id}-${row.location_id}`}
                row={row}
                locationPath={pathOf(locations.data ?? [], row.location_id) || "Ubicación"}
                isAdmin={isAdmin}
                onEdit={() => setDialog({ type: "edit", row })}
                onDelete={() => setDialog({ type: "delete", row })}
              />
            ))
          )}
        </div>

        {(list.data?.total ?? 0) > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Página {page + 1} de {totalPages} · {list.data?.total} registros
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft /> Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </section>

      {(dialog?.type === "create" || dialog?.type === "edit") && (
        <MinimumDialog
          row={dialog.type === "edit" ? dialog.row : null}
          locations={locations.data ?? []}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "delete" && (
        <DeleteMinimumDialog
          row={dialog.row}
          locationPath={pathOf(locations.data ?? [], dialog.row.location_id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function SummaryTile({
  tone,
  icon: Icon,
  label,
  value,
  loading,
  active,
  onClick,
}: {
  tone: "alert" | "muted" | "sky";
  icon: typeof AlertTriangle;
  label: string;
  value: number | undefined;
  loading: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 rounded-3xl p-5 text-left transition",
        tone === "alert" && "bg-graphite text-graphite-foreground",
        tone === "muted" && "surface-card",
        tone === "sky" && "surface-sky",
        active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          tone === "alert" ? "bg-primary text-primary-foreground" : "bg-card text-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span>
        <span className="block text-3xl font-bold tabular">{loading ? "…" : (value ?? 0)}</span>
        <span
          className={cn(
            "text-sm",
            tone === "alert" ? "text-graphite-muted" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </span>
    </Comp>
  );
}

function MinimumCard({
  row,
  locationPath,
  isAdmin,
  onEdit,
  onDelete,
}: {
  row: MinimumRow;
  locationPath: string;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const unit = {
    name_singular: row.unit_singular,
    name_plural: row.unit_plural,
    allows_decimal: row.allows_decimal,
  };
  const state = minimumState(row.quantity, row.min_quantity);
  const missing = shortfall(row.quantity, row.min_quantity);
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-center",
        state === "below" && "border-warning bg-warning-soft/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-graphite px-2.5 py-0.5 font-mono text-xs text-graphite-foreground">
            {row.sku ?? "Borrador sin SKU"}
          </span>
          <span className="font-semibold">{row.product_name}</span>
          {row.variant_label && (
            <span className="text-sm text-muted-foreground">· {row.variant_label}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{locationPath}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:text-right">
        <dt className="text-muted-foreground">Existencia</dt>
        <dt className="text-muted-foreground">Mínimo</dt>
        <dd className="font-semibold tabular">{formatQuantity(row.quantity, unit)}</dd>
        <dd className="font-semibold tabular">{formatQuantity(row.min_quantity, unit)}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2 md:w-60 md:justify-end">
        {state === "below" ? (
          <Badge variant="warning">
            <AlertTriangle /> Bajo mínimo · faltan {formatQuantity(missing, unit)}
          </Badge>
        ) : state === "pending" ? (
          <Badge variant="muted">
            <Clock /> Pendiente de conteo
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 /> En nivel
          </Badge>
        )}
        {row.counted_at && (
          <span className="text-xs text-muted-foreground">
            Contado {formatDate(row.counted_at)}
          </span>
        )}
        {isAdmin && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={`Editar mínimo de ${row.sku ?? row.product_name}`}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              aria-label={`Quitar mínimo de ${row.sku ?? row.product_name}`}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

function EmptyState({
  view,
  search,
  isAdmin,
  configured,
}: {
  view: "alerts" | "all";
  search: string;
  isAdmin: boolean;
  configured: number;
}) {
  let text: string;
  if (search) text = `Nada coincide con «${search}».`;
  else if (view === "alerts" && configured > 0)
    text = "Todo en orden: ningún SKU contado está por debajo de su mínimo.";
  else if (isAdmin)
    text = "Aún no hay niveles mínimos. Usa «Agregar mínimo» para definirlos por SKU y ubicación.";
  else text = "Aún no hay niveles mínimos configurados. El Administrador puede definirlos.";
  return (
    <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {view === "alerts" && configured > 0 && !search ? (
        <CheckCircle2 className="mx-auto mb-2 size-6 text-success" aria-hidden />
      ) : null}
      {text}
    </div>
  );
}

interface VariantOption {
  id: string;
  sku: string | null;
  product_name: string;
  variant_label: string | null;
  unit_singular: string;
  unit_plural: string;
  allows_decimal: boolean;
}

function MinimumDialog({
  row,
  locations,
  onClose,
}: {
  row: MinimumRow | null;
  locations: TreeItem[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = !!row;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [variant, setVariant] = useState<VariantOption | null>(
    row
      ? {
          id: row.variant_id,
          sku: row.sku,
          product_name: row.product_name,
          variant_label: row.variant_label,
          unit_singular: row.unit_singular,
          unit_plural: row.unit_plural,
          allows_decimal: row.allows_decimal,
        }
      : null,
  );
  const [locationId, setLocationId] = useState(row?.location_id ?? "");
  const [minRaw, setMinRaw] = useState(row ? String(row.min_quantity) : "");
  const [errors, setErrors] = useState<{
    variant?: string;
    location?: string;
    min?: string;
    form?: string;
  }>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["search-variants", debounced],
    enabled: !editing,
    queryFn: async (): Promise<VariantOption[]> => {
      const { data, error } = await supabase.rpc("search_variants", { _q: debounced, _limit: 12 });
      if (error) throw error;
      return data ?? [];
    },
  });

  const locationOptions = useMemo(
    () =>
      flattenTree(buildTree(locations))
        .filter((l) => l.is_active)
        .map((l) => ({ value: l.id, label: pathOf(locations, l.id) })),
    [locations],
  );

  const save = useMutation({
    mutationFn: async (value: number) => {
      const { error } = await supabase
        .from("stock_minimums")
        .upsert(
          { variant_id: variant!.id, location_id: locationId, min_quantity: value },
          { onConflict: "variant_id,location_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Mínimo actualizado" : "Mínimo guardado");
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
      onClose();
    },
    onError: (e) => setErrors({ form: friendlyError(e) }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!variant) next.variant = "Elige un SKU";
    if (!locationId) next.location = "Elige una ubicación";
    const parsed = parseMinimum(minRaw, variant?.allows_decimal ?? true);
    if (!parsed.ok) next.min = parsed.error;
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok) return;
    save.mutate(parsed.value);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl">
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar nivel mínimo" : "Nuevo nivel mínimo"}</DialogTitle>
            <DialogDescription>
              El mínimo se expresa en la unidad base del SKU y aplica solo a la ubicación elegida.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="min-sku">SKU</Label>
            {variant ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted p-3 text-sm">
                <span>
                  <span className="font-mono font-semibold">{variant.sku ?? "Borrador"}</span> ·{" "}
                  {variant.product_name}
                  {variant.variant_label ? ` · ${variant.variant_label}` : ""}
                </span>
                {!editing && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVariant(null)}>
                    Cambiar
                  </Button>
                )}
              </div>
            ) : (
              <>
                <Input
                  id="min-sku"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Busca por SKU o nombre"
                  autoFocus
                  aria-invalid={!!errors.variant}
                />
                <div
                  className="max-h-56 overflow-y-auto rounded-2xl border"
                  role="listbox"
                  aria-label="Resultados"
                >
                  {results.isLoading ? (
                    <p className="p-3 text-sm text-muted-foreground">Buscando…</p>
                  ) : (results.data?.length ?? 0) === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">
                      {debounced
                        ? "Ningún SKU coincide."
                        : "Todavía no hay SKU registrados. Se capturan en «Capturar SKU»."}
                    </p>
                  ) : (
                    results.data!.map((v) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        key={v.id}
                        onClick={() => setVariant(v)}
                        className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus:bg-accent focus:outline-none"
                      >
                        <span className="font-mono font-semibold">{v.sku ?? "Borrador"}</span> ·{" "}
                        {v.product_name}
                        {v.variant_label ? (
                          <span className="text-muted-foreground"> · {v.variant_label}</span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
            {errors.variant && <p className="text-sm text-destructive">{errors.variant}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="min-loc">Ubicación</Label>
            <Select value={locationId} onValueChange={setLocationId} disabled={editing}>
              <SelectTrigger id="min-loc" className="rounded-2xl" aria-invalid={!!errors.location}>
                <SelectValue placeholder="Elige la ubicación" />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {locationOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.location && <p className="text-sm text-destructive">{errors.location}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="min-qty">Nivel mínimo</Label>
            <div className="flex items-center gap-2">
              <Input
                id="min-qty"
                inputMode="decimal"
                value={minRaw}
                onChange={(e) => setMinRaw(e.target.value)}
                className="w-40 tabular"
                aria-invalid={!!errors.min}
              />
              <span className="text-sm text-muted-foreground">
                {variant ? variant.unit_plural : "unidad base"}
              </span>
            </div>
            {variant && !variant.allows_decimal && (
              <p className="text-xs text-muted-foreground">
                Esta unidad solo admite números enteros.
              </p>
            )}
            {errors.min && <p className="text-sm text-destructive">{errors.min}</p>}
          </div>

          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
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

function DeleteMinimumDialog({
  row,
  locationPath,
  onClose,
}: {
  row: MinimumRow;
  locationPath: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("stock_minimums")
        .delete()
        .eq("variant_id", row.variant_id)
        .eq("location_id", row.location_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mínimo eliminado");
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
      onClose();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Quitar nivel mínimo</DialogTitle>
          <DialogDescription>
            {row.sku ?? row.product_name} en {locationPath}. Ya no se generarán alertas para esta
            ubicación. Las existencias no cambian.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending && <Loader2 className="animate-spin" />} Quitar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
