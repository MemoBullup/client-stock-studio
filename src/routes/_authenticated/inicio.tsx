import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  ClipboardCheck,
  Coins,
  FileSpreadsheet,
  FolderTree,
  Hash,
  ScanLine,
  Tags,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLowStockSummary } from "@/lib/alerts";
import { pct, useAdminDashboard, useDashboard } from "@/lib/dashboard";
import { formatMoney, formatNumber } from "@/lib/format";
import { useMe, useSettings } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/inicio")({
  head: () => ({
    meta: [
      { title: "Inicio · Aly Inventario" },
      { name: "description", content: "Avance del levantamiento de inventario de Aly." },
      { property: "og:title", content: "Inicio · Aly Inventario" },
      { property: "og:description", content: "Avance del levantamiento de inventario de Aly." },
    ],
  }),
  component: InicioPage,
});

function InicioPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isAdmin = me?.role === "admin";
  const { data: stats, isLoading, isError } = useDashboard();
  const admin = useAdminDashboard(isAdmin);
  const { data: alerts, isLoading: alertsLoading } = useLowStockSummary();
  const goal = settings?.sku_goal ?? 5000;
  const registered = stats?.registered ?? 0;
  const progress = Math.min(100, (registered / goal) * 100);
  const today = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      <PageHeader
        title={`Hola, ${me?.fullName.split(" ")[0] ?? ""}`}
        description={`Hoy es ${today}. Este es el avance del levantamiento de inventario.`}
        actions={
          <Link
            to="/escanear"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-graphite px-5 text-sm font-semibold text-graphite-foreground"
          >
            <ScanLine className="size-4" /> Escanear QR
          </Link>
        }
      />

      {isError && (
        <div role="alert" className="surface-card mb-4 p-5 text-sm text-destructive">
          No se pudieron cargar los indicadores. Revisa tu conexión y recarga la página.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="surface-card p-6 sm:p-8" aria-labelledby="meta-title">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="meta-title" className="text-sm font-medium text-muted-foreground">
                SKU registrados
              </h2>
              <div className="mt-1 text-5xl font-bold tracking-tight tabular">
                {isLoading ? <Skeleton className="h-12 w-32" /> : formatNumber(registered, 0)}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                de una meta de <strong className="text-foreground">{formatNumber(goal, 0)}</strong>{" "}
                SKU
                {isAdmin && (
                  <>
                    {" · "}
                    <Link to="/usuarios" className="font-semibold underline underline-offset-2">
                      Editar meta
                    </Link>
                  </>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6 text-right sm:grid-cols-3">
              <Stat label="Capturas de hoy" value={stats?.today} loading={isLoading} />
              <Stat
                label="Pendientes de revisión"
                value={stats?.pending_review}
                loading={isLoading}
              />
              <Stat label="Mis borradores" value={stats?.my_drafts} loading={isLoading} />
            </div>
          </div>
          <div className="mt-8">
            <div
              className="h-4 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-valuenow={registered}
              aria-label="Avance hacia la meta de SKU"
            >
              <div
                className="progress-stripes h-full rounded-full transition-all"
                style={{ width: `${Math.max(progress, 1.5)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatNumber(progress, 1)}% de la meta</span>
              <span>Faltan {formatNumber(Math.max(goal - registered, 0), 0)} SKU</span>
            </div>
          </div>
        </section>

        <section
          className="surface-graphite grid content-start gap-3 p-6 sm:p-8"
          aria-labelledby="pend-title"
        >
          <h2 id="pend-title" className="text-sm font-medium text-graphite-muted">
            Pendientes del levantamiento
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <MiniTile
              icon={Hash}
              label="Pendientes de conteo"
              value={stats?.pending_count}
              loading={isLoading}
              to="/inventario"
              search={{ existencia: "pending" }}
            />
            <MiniTile
              icon={Camera}
              label="Pendientes de fotografía"
              value={stats?.pending_photo}
              loading={isLoading}
              to="/inventario"
              search={{ foto: "without" }}
            />
            <MiniTile
              icon={FolderTree}
              label="Por clasificar"
              value={stats?.unclassified.skus}
              loading={isLoading}
              to="/inventario"
              search={{ porClasificar: true }}
            />
            <MiniTile
              icon={ClipboardCheck}
              label="Por revisar"
              value={stats?.pending_review}
              loading={isLoading}
              to="/inventario"
              search={{ revision: "pending" }}
            />
          </div>
          <p className="text-xs text-graphite-muted">
            Se cuentan SKU, no piezas ni metros: las cantidades físicas no se suman entre unidades
            distintas.
          </p>
        </section>
      </div>

      <Link
        to="/alertas"
        className={
          (alerts?.below ?? 0) > 0
            ? "mt-4 flex flex-wrap items-center gap-4 rounded-3xl border border-warning bg-warning-soft p-5 transition hover:brightness-[0.98]"
            : "surface-card mt-4 flex flex-wrap items-center gap-4 p-5 transition hover:brightness-[0.99]"
        }
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-graphite text-primary">
          <AlertTriangle className="size-5" aria-hidden />
        </span>
        <span className="flex-1">
          <span className="block font-bold">
            {alertsLoading
              ? "Revisando existencias…"
              : (alerts?.below ?? 0) > 0
                ? `${alerts!.below} SKU por debajo de su nivel mínimo`
                : "Sin alertas de existencias"}
          </span>
          <span className="text-sm text-muted-foreground">
            {(alerts?.configured ?? 0) === 0
              ? "Todavía no hay niveles mínimos configurados."
              : `${alerts!.configured} mínimos configurados · ${alerts!.pending} pendientes de conteo`}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-sm font-semibold">
          Ver alertas <ArrowUpRight className="size-4" />
        </span>
      </Link>

      <section className="surface-card mt-4 p-6 sm:p-8" aria-labelledby="cat-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cat-title" className="text-lg font-bold">
            Avance por categoría
          </h2>
          <span className="text-xs text-muted-foreground">SKU registrados · % contados</span>
        </div>
        {isLoading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <ul className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
            {[
              ...(stats?.categories ?? []),
              ...((stats?.unclassified.skus ?? 0) > 0
                ? [
                    {
                      id: "none",
                      name: "Por clasificar",
                      skus: stats!.unclassified.skus,
                      counted: stats!.unclassified.counted,
                      photographed: 0,
                    },
                  ]
                : []),
            ].map((c) => {
              const share = pct(c.skus, registered);
              const counted = pct(c.counted, c.skus);
              return (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{c.name}</span>
                    <span className="shrink-0 tabular text-muted-foreground">
                      <strong className="text-foreground">{formatNumber(c.skus, 0)}</strong> SKU ·{" "}
                      {formatNumber(counted, 1)}% contados
                    </span>
                  </div>
                  <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className="flex h-full"
                      style={{ width: `${Math.max(share, c.skus ? 2 : 0)}%` }}
                    >
                      <div className="h-full bg-primary" style={{ width: `${counted}%` }} />
                      <div className="h-full flex-1 bg-gold" />
                    </div>
                  </div>
                </li>
              );
            })}
            {(stats?.categories.length ?? 0) === 0 && (stats?.unclassified.skus ?? 0) === 0 && (
              <li className="text-sm text-muted-foreground">
                Aún no hay categorías con SKU registrados.
              </li>
            )}
          </ul>
        )}
        <p className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-primary" /> Contados
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-gold" /> Pendientes de conteo
          </span>
          <span>El largo de la barra es la proporción del catálogo.</span>
        </p>
      </section>

      {isAdmin && (
        <AdminPanels
          data={admin.data}
          loading={admin.isLoading}
          error={admin.isError}
          currencyFallback={settings?.currency ?? "MXN"}
        />
      )}

      <section className="surface-card mt-4 p-6 sm:p-8" aria-labelledby="avance-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="avance-title" className="text-lg font-bold">
            Avance de la plataforma
          </h2>
          <Badge variant="info">Se habilita por bloques</Badge>
        </div>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              b: "A",
              t: "Base, accesos y categorías",
              d: "Inicio de sesión, roles, categorías, ubicaciones y configuración.",
              s: "done",
            },
            {
              b: "B",
              t: "Captura e inventario",
              d: "Capturar SKU, variantes, conteos y consulta del catálogo.",
              s: "done",
            },
            {
              b: "C",
              t: "QR, etiquetas e informes",
              d: "Etiquetas con QR, lectura con cámara, descargas y tablero.",
              s: "done",
            },
            {
              b: "D",
              t: "Fotografías y ecommerce",
              d: "Ya se suben fotos. Falta la cola por ubicación y los datos comerciales.",
              s: "partial",
            },
          ].map((x) => (
            <li
              key={x.b}
              className={
                x.s === "done" ? "rounded-2xl bg-success-soft p-4" : "rounded-2xl bg-gold-soft p-4"
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Bloque {x.b}
                </span>
                <Badge variant={x.s === "done" ? "success" : "warning"}>
                  {x.s === "done" ? "Disponible" : "En parte"}
                </Badge>
              </div>
              <p className="mt-2 font-semibold">{x.t}</p>
              <p className="mt-1 text-xs text-muted-foreground">{x.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function AdminPanels({
  data,
  loading,
  error,
  currencyFallback,
}: {
  data: ReturnType<typeof useAdminDashboard>["data"];
  loading: boolean;
  error: boolean;
  currencyFallback: string;
}) {
  if (error) {
    return (
      <div role="alert" className="surface-card mt-4 p-5 text-sm text-destructive">
        No se pudo cargar la información del Administrador.
      </div>
    );
  }
  const coverage = data ? pct(data.valued, data.counted) : 0;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <section className="surface-graphite p-6 sm:p-8" aria-labelledby="val-title">
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-gold" aria-hidden />
          <h2 id="val-title" className="text-sm font-medium text-graphite-muted">
            Valor estimado de existencias (parcial)
          </h2>
        </div>
        {loading || !data ? (
          <Skeleton className="mt-3 h-12 w-48 bg-graphite-soft" />
        ) : data.valuation.length === 0 ? (
          <p className="mt-3 text-2xl font-bold">Sin datos suficientes</p>
        ) : (
          data.valuation.map((v) => (
            <p key={v.currency} className="mt-2 text-4xl font-bold tracking-tight tabular">
              {formatMoney(Number(v.value), v.currency || currencyFallback)}
            </p>
          ))
        )}
        <p className="mt-2 text-xs text-graphite-muted">
          Solo suma SKU con conteo <em>y</em> costo conocidos. No es el valor total del inventario.
        </p>
        <div className="mt-5">
          <div className="flex justify-between text-xs">
            <span>Cobertura de la valoración</span>
            <span className="tabular font-semibold">{formatNumber(coverage, 1)}%</span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-graphite-soft" aria-hidden>
            <div className="h-full rounded-full bg-gold" style={{ width: `${coverage}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-graphite-muted">
            {data
              ? `${formatNumber(data.valued, 0)} de ${formatNumber(data.counted, 0)} SKU contados tienen costo.`
              : "…"}
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-graphite-soft p-4">
            <p className="text-3xl font-bold tabular">
              {data ? formatNumber(data.cost_pending, 0) : "…"}
            </p>
            <p className="text-xs text-graphite-muted">SKU con costo pendiente</p>
          </div>
          <div className="rounded-2xl bg-graphite-soft p-4">
            <p className="text-3xl font-bold tabular">
              {data ? formatNumber(data.counted_without_cost, 0) : "…"}
            </p>
            <p className="text-xs text-graphite-muted">Contados sin costo</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/inventario"
            search={{ costoPendiente: true }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Capturar costos <ArrowUpRight className="size-4" />
          </Link>
          <Link
            to="/informes"
            className="inline-flex items-center gap-1.5 rounded-full border border-graphite-border px-4 py-2 text-sm font-semibold hover:bg-graphite-soft"
          >
            <FileSpreadsheet className="size-4" /> Informes
          </Link>
        </div>
      </section>

      <section className="surface-card p-6 sm:p-8" aria-labelledby="act-title">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          <h2 id="act-title" className="text-lg font-bold">
            Actividad por capturista
          </h2>
        </div>
        {loading || !data ? (
          <Skeleton className="mt-4 h-32 w-full" />
        ) : data.activity.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Todavía no hay capturas.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-semibold">Persona</th>
                  <th className="py-2 text-right font-semibold">Hoy</th>
                  <th className="py-2 text-right font-semibold">7 días</th>
                  <th className="py-2 text-right font-semibold">Total SKU</th>
                  <th className="py-2 text-right font-semibold">Conteos hoy</th>
                  <th className="py-2 text-right font-semibold">Borradores</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.activity.map((a) => (
                  <tr key={a.user_id}>
                    <td className="py-2.5 font-medium">{a.name}</td>
                    <td className="py-2.5 text-right tabular font-semibold">
                      {formatNumber(a.today, 0)}
                    </td>
                    <td className="py-2.5 text-right tabular">{formatNumber(a.week, 0)}</td>
                    <td className="py-2.5 text-right tabular">{formatNumber(a.total, 0)}</td>
                    <td className="py-2.5 text-right tabular">{formatNumber(a.counts_today, 0)}</td>
                    <td className="py-2.5 text-right tabular text-muted-foreground">
                      {formatNumber(a.drafts, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Tags className="size-3.5" /> SKU confirmados por quien los capturó; los conteos incluyen
          otras ubicaciones.
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value?: number | undefined;
  loading: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular">{loading ? "…" : formatNumber(value ?? 0, 0)}</p>
    </div>
  );
}

function MiniTile({
  icon: Icon,
  label,
  value,
  loading,
  to,
  search,
}: {
  icon: typeof FolderTree;
  label: string;
  value?: number | undefined;
  loading: boolean;
  to: "/inventario";
  search: {
    existencia?: "pending";
    foto?: "without";
    porClasificar?: boolean;
    revision?: "pending";
  };
}) {
  return (
    <Link
      to={to}
      search={search}
      className="rounded-2xl bg-graphite-soft p-4 transition hover:brightness-110"
    >
      <Icon className="size-4 text-primary" aria-hidden />
      <p className="mt-3 text-3xl font-bold tabular">
        {loading ? "…" : formatNumber(value ?? 0, 0)}
      </p>
      <p className="text-xs text-graphite-muted">{label}</p>
    </Link>
  );
}
