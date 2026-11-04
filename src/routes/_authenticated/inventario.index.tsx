import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LayoutGrid,
  Loader2,
  PackagePlus,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TreeSelect } from "@/components/capture/TreeSelect";
import { BulkActions } from "@/components/catalog/BulkActions";
import { PhotoThumb } from "@/components/photos/VariantThumb";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  catalogQuery,
  categoriesQuery,
  locationsQuery,
  productTypesQuery,
  RECORD_LABEL,
  staffQuery,
  treePath,
  type CatalogFilters,
  type CatalogRow,
} from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { useSignedUrls } from "@/lib/photos";
import { useMe, useSettings } from "@/lib/session";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
type InventarioSearch = CatalogFilters & { vista?: "tabla" | "tarjetas" | undefined };
const NONE = "__none";

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

export const Route = createFileRoute("/_authenticated/inventario/")({
  validateSearch: (s: Record<string, unknown>): InventarioSearch => ({
    q: str(s["q"]),
    categoria: str(s["categoria"]),
    porClasificar: s["porClasificar"] === true || s["porClasificar"] === "true" ? true : undefined,
    tipo: str(s["tipo"]),
    ubicacion: str(s["ubicacion"]),
    existencia: oneOf(s["existencia"], ["with", "zero", "pending"] as const),
    foto: oneOf(s["foto"], ["with", "without"] as const),
    revision: oneOf(s["revision"], ["pending", "validated"] as const),
    registro: oneOf(s["registro"], ["draft", "registered", "archived"] as const),
    capturista: str(s["capturista"]),
    desde: str(s["desde"]),
    hasta: str(s["hasta"]),
    color: str(s["color"]),
    medida: str(s["medida"]),
    medidaValor: str(s["medidaValor"]),
    costoPendiente:
      s["costoPendiente"] === true || s["costoPendiente"] === "true" ? true : undefined,
    orden: oneOf(s["orden"], ["recent", "sku", "name", "quantity"] as const),
    pagina:
      typeof s["pagina"] === "number" && s["pagina"] > 0 ? Math.floor(s["pagina"]) : undefined,
    vista: oneOf(s["vista"], ["tabla", "tarjetas"] as const),
  }),
  head: () => ({
    meta: [
      { title: "Inventario · Aly Inventario" },
      {
        name: "description",
        content: "Consulta del catálogo con búsqueda, filtros y existencias por ubicación.",
      },
      { property: "og:title", content: "Inventario · Aly Inventario" },
      {
        property: "og:description",
        content: "Consulta del catálogo con búsqueda, filtros y existencias por ubicación.",
      },
    ],
  }),
  component: InventarioPage,
});

function StatusBadges({ row }: { row: CatalogRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {row.record_status !== "registered" && (
        <Badge variant={row.record_status === "draft" ? "muted" : "outline"}>
          {RECORD_LABEL[row.record_status]}
        </Badge>
      )}
      {row.record_status === "registered" && (
        <Badge variant={row.review_status === "validated" ? "success" : "info"}>
          {row.review_status === "validated" ? "Validado" : "Por revisar"}
        </Badge>
      )}
      {row.counted_locations === 0 && <Badge variant="warning">Pendiente de conteo</Badge>}
      {row.in_review_count > 0 && <Badge variant="warning">Conteo en revisión</Badge>}
      {!row.category_id && <Badge variant="outline">Por clasificar</Badge>}
      {row.sku?.startsWith("DEMO-") && <Badge variant="demo">DEMO</Badge>}
    </div>
  );
}

function QuantityCell({ row }: { row: CatalogRow }) {
  if (row.counted_locations === 0)
    return <span className="text-sm text-muted-foreground">Pendiente de conteo</span>;
  const q = Number(row.total_quantity ?? 0);
  return (
    <span className="tabular text-sm font-semibold">
      {formatNumber(q, row.allows_decimal ? 3 : 0)} {q === 1 ? row.unit_singular : row.unit_plural}
    </span>
  );
}

function Thumb({ className, src, alt }: { className?: string; src?: string | undefined; alt: string }) {
  return <PhotoThumb src={src} alt={alt} className={cn("rounded-xl", className)} />;
}

function InventarioPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/inventario/" });
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isAdmin = me?.role === "admin";
  const { vista, ...filters } = search;
  const view = vista ?? "tabla";

  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: locations = [] } = useQuery(locationsQuery);
  const { data: types = [] } = useQuery(productTypesQuery);
  const { data: staff = [] } = useQuery(staffQuery);
  const result = useQuery(catalogQuery(filters, PAGE_SIZE));
  const rows = result.data?.rows ?? [];
  const total = result.data?.total ?? 0;
  const page = filters.pagina ?? 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const thumbs = useSignedUrls(rows.map((r) => r.primary_image));
  const thumbOf = (r: CatalogRow) => (r.primary_image ? thumbs.data?.get(r.primary_image) : undefined);

  // Costos: solo Administrador y solo de los SKU visibles (la base de datos lo impide a otros).
  const ids = rows.map((r) => r.id);
  const costs = useQuery({
    queryKey: ["catalog", "costs", ids],
    enabled: isAdmin && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variant_costs")
        .select("variant_id, cost_per_base_unit, currency")
        .in("variant_id", ids);
      if (error) throw error;
      return new Map((data ?? []).map((c) => [c.variant_id, c]));
    },
  });

  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => setQ(filters.q ?? ""), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const [showFilters, setShowFilters] = useState(false);

  function setFilter(patch: InventarioSearch) {
    navigate({
      search: (prev) => ({
        ...prev,
        ...patch,
        pagina: "pagina" in patch ? patch.pagina : undefined,
      }),
      replace: true,
    });
  }

  const allAttrs = useMemo(() => {
    const map = new Map<string, (typeof types)[number]["attributes"][number]>();
    for (const t of types) for (const a of t.attributes) map.set(a.id, a);
    return [...map.values()];
  }, [types]);
  const colorAttr = allAttrs.find((a) => a.code === "color_principal");
  const measureAttrs = allAttrs.filter((a) => a.data_type === "number");

  const activeFilters = [
    filters.categoria || filters.porClasificar,
    filters.tipo,
    filters.ubicacion,
    filters.existencia,
    filters.foto,
    filters.revision,
    filters.registro,
    filters.capturista,
    filters.desde,
    filters.hasta,
    filters.color,
    filters.medida && filters.medidaValor,
    filters.costoPendiente,
  ].filter(Boolean).length;

  const currency = settings?.currency ?? "MXN";

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="Busca por SKU, nombre, diseño, color, código de proveedor, etiqueta de uso o ubicación. No importan mayúsculas ni acentos."
        actions={
          <>
            {isAdmin && <BulkActions filters={filters} total={total} />}
            <Button variant="outline" asChild>
              <Link to="/revisiones">
                <ClipboardList /> Revisiones
              </Link>
            </Button>
            <Button asChild>
              <Link to="/capturar" search={{}}>
                <PackagePlus /> Capturar SKU
              </Link>
            </Button>
          </>
        }
      />

      <div className="surface-card mb-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en el catálogo"
              className="pl-10"
              aria-label="Buscar en el catálogo"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={showFilters ? "graphite" : "outline"}
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal /> Filtros{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Button>
            <Select
              value={filters.orden ?? "recent"}
              onValueChange={(v) => setFilter({ orden: v as CatalogFilters["orden"] })}
            >
              <SelectTrigger className="w-[190px]" aria-label="Ordenar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Capturados recientemente</SelectItem>
                <SelectItem value="sku">SKU</SelectItem>
                <SelectItem value="name">Nombre</SelectItem>
                <SelectItem value="quantity">Mayor cantidad</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-full bg-muted p-1" role="group" aria-label="Vista">
              <Button
                size="icon-sm"
                variant={view === "tabla" ? "graphite" : "ghost"}
                aria-pressed={view === "tabla"}
                aria-label="Vista de tabla"
                onClick={() => setFilter({ vista: "tabla", pagina: page })}
              >
                <Rows3 />
              </Button>
              <Button
                size="icon-sm"
                variant={view === "tarjetas" ? "graphite" : "ghost"}
                aria-pressed={view === "tarjetas"}
                aria-label="Vista de tarjetas"
                onClick={() => setFilter({ vista: "tarjetas", pagina: page })}
              >
                <LayoutGrid />
              </Button>
            </div>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Categoría">
              <TreeSelect
                items={categories}
                includeInactive
                value={filters.categoria ?? null}
                onChange={(id) =>
                  setFilter({ categoria: id ?? undefined, porClasificar: undefined })
                }
                noneLabel="Todas"
              />
              <label className="mt-1.5 flex items-center gap-2 text-xs">
                <Checkbox
                  checked={!!filters.porClasificar}
                  onCheckedChange={(v) =>
                    setFilter({
                      porClasificar: v === true ? true : undefined,
                      categoria: undefined,
                    })
                  }
                />
                Solo «Por clasificar»
              </label>
            </FilterField>
            <FilterField label="Tipo">
              <SimpleSelect
                value={filters.tipo}
                onChange={(v) => setFilter({ tipo: v })}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
              />
            </FilterField>
            <FilterField label="Ubicación (incluye las que contiene)">
              <TreeSelect
                items={locations}
                includeInactive
                value={filters.ubicacion ?? null}
                onChange={(id) => setFilter({ ubicacion: id ?? undefined })}
                noneLabel="Todas"
              />
            </FilterField>
            <FilterField label="Existencia">
              <SimpleSelect
                value={filters.existencia}
                onChange={(v) => setFilter({ existencia: v as CatalogFilters["existencia"] })}
                options={[
                  { value: "with", label: "Con existencia" },
                  { value: "zero", label: "Contado sin existencia (0)" },
                  { value: "pending", label: "Pendiente de conteo" },
                ]}
              />
            </FilterField>
            <FilterField label="Color">
              <SimpleSelect
                value={filters.color}
                onChange={(v) => setFilter({ color: v })}
                options={(colorAttr?.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            </FilterField>
            <FilterField label="Medida">
              <div className="flex gap-2">
                <SimpleSelect
                  value={filters.medida}
                  onChange={(v) => setFilter({ medida: v })}
                  options={measureAttrs.map((a) => ({ value: a.id, label: a.name }))}
                  placeholder="Atributo"
                />
                <Input
                  className="w-24"
                  inputMode="decimal"
                  aria-label="Valor de la medida"
                  defaultValue={filters.medidaValor ?? ""}
                  onBlur={(e) => setFilter({ medidaValor: e.target.value.trim() || undefined })}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    setFilter({
                      medidaValor: (e.target as HTMLInputElement).value.trim() || undefined,
                    })
                  }
                  placeholder="Valor"
                />
              </div>
            </FilterField>
            <FilterField label="Fotografía">
              <SimpleSelect
                value={filters.foto}
                onChange={(v) => setFilter({ foto: v as CatalogFilters["foto"] })}
                options={[
                  { value: "with", label: "Con fotografía" },
                  { value: "without", label: "Sin fotografía" },
                ]}
              />
            </FilterField>
            <FilterField label="Revisión">
              <SimpleSelect
                value={filters.revision}
                onChange={(v) => setFilter({ revision: v as CatalogFilters["revision"] })}
                options={[
                  { value: "pending", label: "Pendiente de revisión" },
                  { value: "validated", label: "Validado" },
                ]}
              />
            </FilterField>
            <FilterField label="Registro">
              <SimpleSelect
                value={filters.registro}
                onChange={(v) => setFilter({ registro: v as CatalogFilters["registro"] })}
                placeholder="Todos (sin archivados)"
                options={[
                  { value: "registered", label: "Registrados" },
                  { value: "draft", label: isAdmin ? "Borradores" : "Mis borradores" },
                  ...(isAdmin ? [{ value: "archived", label: "Archivados" }] : []),
                ]}
              />
            </FilterField>
            <FilterField label="Capturó">
              <SimpleSelect
                value={filters.capturista}
                onChange={(v) => setFilter({ capturista: v })}
                options={staff.map((s) => ({
                  value: s.id,
                  label: s.full_name || s.email || "Usuario",
                }))}
              />
            </FilterField>
            <FilterField label="Capturado desde / hasta">
              <div className="flex gap-2">
                <Input
                  type="date"
                  aria-label="Desde"
                  value={filters.desde ?? ""}
                  onChange={(e) => setFilter({ desde: e.target.value || undefined })}
                />
                <Input
                  type="date"
                  aria-label="Hasta"
                  value={filters.hasta ?? ""}
                  onChange={(e) => setFilter({ hasta: e.target.value || undefined })}
                />
              </div>
            </FilterField>
            {isAdmin && (
              <FilterField label="Costo">
                <label className="flex h-10 items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!filters.costoPendiente}
                    onCheckedChange={(v) =>
                      setFilter({ costoPendiente: v === true ? true : undefined })
                    }
                  />
                  Solo costo pendiente
                </label>
              </FilterField>
            )}
            {activeFilters > 0 && (
              <div className="flex items-end sm:col-span-2 lg:col-span-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate({
                      search: { q: filters.q, orden: filters.orden, vista },
                      replace: true,
                    })
                  }
                >
                  <X /> Quitar filtros
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="mb-3 flex items-center justify-between text-sm text-muted-foreground"
        aria-live="polite"
      >
        <span>
          {result.isLoading
            ? "Cargando…"
            : `${formatNumber(total, 0)} ${total === 1 ? "SKU" : "SKU"} encontrados`}
          {result.isFetching && !result.isLoading && (
            <Loader2 className="ml-2 inline size-3.5 animate-spin" />
          )}
        </span>
        {pages > 1 && (
          <span>
            Página {page} de {pages}
          </span>
        )}
      </div>

      {result.isError ? (
        <div className="surface-card p-8 text-center">
          <p className="font-semibold">No pudimos cargar el inventario</p>
          <p className="mt-1 text-sm text-muted-foreground">{friendlyError(result.error)}</p>
          <Button className="mt-4" onClick={() => result.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : result.isLoading ? (
        <div className="surface-card space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <p className="font-semibold">Sin resultados</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeFilters > 0 || filters.q
              ? "Prueba con otra búsqueda o quita algunos filtros."
              : "Aún no hay SKU capturados."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/capturar" search={{}}>
              <PackagePlus /> Capturar SKU
            </Link>
          </Button>
        </div>
      ) : view === "tabla" ? (
        <div className="surface-card overflow-x-auto p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">
                  <span className="sr-only">Miniatura</span>
                </th>
                <th className="px-2 py-3 font-semibold">SKU</th>
                <th className="px-2 py-3 font-semibold">Nombre</th>
                <th className="px-2 py-3 font-semibold">Variante</th>
                <th className="px-2 py-3 font-semibold">Categoría</th>
                <th className="px-2 py-3 text-right font-semibold">Cantidad</th>
                <th className="px-2 py-3 font-semibold">Ubicación</th>
                {isAdmin && <th className="px-2 py-3 text-right font-semibold">Costo</th>}
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const cost = costs.data?.get(r.id);
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      navigate({ to: "/inventario/$variantId", params: { variantId: r.id } })
                    }
                  >
                    <td className="px-4 py-2.5">
                      <Thumb className="size-10" src={thumbOf(r)} alt={r.product_name} />
                    </td>
                    <td className="px-2 py-2.5 font-mono text-xs font-semibold">
                      <Link
                        to="/inventario/$variantId"
                        params={{ variantId: r.id }}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.sku ?? "Borrador"}
                      </Link>
                    </td>
                    <td className="max-w-[220px] px-2 py-2.5 font-medium">{r.product_name}</td>
                    <td className="px-2 py-2.5 text-muted-foreground">{r.variant_label ?? "—"}</td>
                    <td className="max-w-[200px] px-2 py-2.5 text-xs text-muted-foreground">
                      {treePath(categories, r.category_id) ?? "Por clasificar"}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <QuantityCell row={r} />
                    </td>
                    <td
                      className="max-w-[180px] truncate px-2 py-2.5 text-xs"
                      title={r.location_names ?? ""}
                    >
                      {r.location_names ?? "—"}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2.5 text-right text-xs tabular">
                        {cost ? (
                          `${formatMoney(Number(cost.cost_per_base_unit), cost.currency)} / ${r.unit_singular}`
                        ) : (
                          <span className="text-warning-foreground">Costo pendiente</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <StatusBadges row={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const cost = costs.data?.get(r.id);
            return (
              <li key={r.id}>
                <Link
                  to="/inventario/$variantId"
                  params={{ variantId: r.id }}
                  className="surface-card flex h-full gap-3 p-4 transition hover:shadow-lg"
                >
                  <Thumb className="size-16 shrink-0" src={thumbOf(r)} alt={r.product_name} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-mono text-xs font-semibold">{r.sku ?? "Borrador"}</p>
                    <p className="truncate font-semibold">{r.product_name}</p>
                    {r.variant_label && (
                      <p className="truncate text-sm text-muted-foreground">{r.variant_label}</p>
                    )}
                    <QuantityCell row={r} />
                    {r.location_names && (
                      <p className="truncate text-xs text-muted-foreground">{r.location_names}</p>
                    )}
                    {isAdmin && (
                      <p className="text-xs">
                        {cost
                          ? `${formatMoney(Number(cost.cost_per_base_unit), cost.currency)} / ${r.unit_singular}`
                          : "Costo pendiente"}
                      </p>
                    )}
                    <StatusBadges row={r} />
                    <p className="text-[11px] text-muted-foreground">
                      {r.created_by_name ?? "—"} · {formatDate(r.created_at)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Paginación">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setFilter({ pagina: page - 1 })}
          >
            <ChevronLeft /> Anterior
          </Button>
          <span className="text-sm tabular">
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setFilter({ pagina: page + 1 })}
          >
            Siguiente <ChevronRight />
          </Button>
        </nav>
      )}
      <p className="sr-only">Moneda: {currency}</p>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SimpleSelect({
  value,
  onChange,
  options,
  placeholder = "Todos",
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
