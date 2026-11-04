import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, ClipboardCheck, FileClock, FolderTree, MapPin, Tags, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useLowStockSummary } from "@/lib/alerts";
import { formatNumber } from "@/lib/format";
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

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function useDashboardStats(userId: string | undefined) {
  return useQuery({
    queryKey: ["dashboard", "basic", userId],
    enabled: !!userId,
    queryFn: async () => {
      const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
        const res = await q;
        if (res.error) throw res.error;
        return res.count ?? 0;
      };
      const [registered, pendingReview, myDrafts, today, categories, locations] = await Promise.all([
        count(supabase.from("variants").select("id", { count: "exact", head: true }).eq("record_status", "registered")),
        count(
          supabase
            .from("variants")
            .select("id", { count: "exact", head: true })
            .eq("record_status", "registered")
            .eq("review_status", "pending"),
        ),
        count(
          supabase
            .from("variants")
            .select("id", { count: "exact", head: true })
            .eq("record_status", "draft")
            .eq("created_by", userId!),
        ),
        count(
          supabase
            .from("variants")
            .select("id", { count: "exact", head: true })
            .eq("record_status", "registered")
            .gte("confirmed_at", startOfToday()),
        ),
        count(supabase.from("categories").select("id", { count: "exact", head: true }).eq("is_active", true)),
        count(supabase.from("locations").select("id", { count: "exact", head: true }).eq("is_active", true)),
      ]);
      return { registered, pendingReview, myDrafts, today, categories, locations };
    },
  });
}

function InicioPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const { data: stats, isLoading, isError } = useDashboardStats(me?.id);
  const goal = settings?.sku_goal ?? 5000;
  const registered = stats?.registered ?? 0;
  const pct = Math.min(100, (registered / goal) * 100);
  const isAdmin = me?.role === "admin";
  const { data: alerts, isLoading: alertsLoading } = useLowStockSummary();
  const today = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(),
  );

  return (
    <>
      <PageHeader
        title={`Hola, ${me?.fullName.split(" ")[0] ?? ""}`}
        description={`Hoy es ${today}. Este es el avance del levantamiento de inventario.`}
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
                de una meta de <strong className="text-foreground">{formatNumber(goal, 0)}</strong> SKU
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6 text-right sm:grid-cols-3">
              <Stat label="Capturas de hoy" value={stats?.today} loading={isLoading} />
              <Stat label="Pendientes de revisión" value={stats?.pendingReview} loading={isLoading} />
              <Stat label="Mis borradores" value={stats?.myDrafts} loading={isLoading} />
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
              <div className="progress-stripes h-full rounded-full transition-all" style={{ width: `${Math.max(pct, 1.5)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatNumber(pct, 1)}% de la meta</span>
              <span>Faltan {formatNumber(Math.max(goal - registered, 0), 0)} SKU</span>
            </div>
          </div>
        </section>

        <section className="surface-graphite p-6 sm:p-8" aria-labelledby="catalogo-title">
          <h2 id="catalogo-title" className="text-sm font-medium text-graphite-muted">
            Estructura del catálogo
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniTile icon={FolderTree} label="Categorías activas" value={stats?.categories} loading={isLoading} />
            <MiniTile icon={MapPin} label="Ubicaciones activas" value={stats?.locations} loading={isLoading} />
          </div>
          {isAdmin && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/catalogos"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Administrar catálogos <ArrowUpRight className="size-4" />
              </Link>
              <Link
                to="/usuarios"
                className="inline-flex items-center gap-1.5 rounded-full border border-graphite-border px-4 py-2 text-sm font-semibold hover:bg-graphite-soft"
              >
                <Users className="size-4" /> Usuarios
              </Link>
            </div>
          )}
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

      <section className="surface-card mt-4 p-6 sm:p-8" aria-labelledby="avance-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="avance-title" className="text-lg font-bold">
            Avance de la plataforma
          </h2>
          <Badge variant="info">Se habilita por bloques</Badge>
        </div>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { b: "A", t: "Base, accesos y categorías", d: "Inicio de sesión, roles, categorías, ubicaciones y configuración.", done: true, icon: ClipboardCheck },
            { b: "B", t: "Captura e inventario", d: "Capturar SKU, variantes, conteos y consulta del catálogo.", done: true, icon: Tags },
            { b: "C", t: "QR, etiquetas e informes", d: "Etiquetas imprimibles, descargas y tablero completo.", done: false, icon: FileClock },
            { b: "D", t: "Fotografías y ecommerce", d: "Carga de imágenes, cola de fotografía y datos comerciales.", done: false, icon: MapPin },
          ].map((s) => (
            <li key={s.b} className={s.done ? "rounded-2xl bg-success-soft p-4" : "rounded-2xl bg-muted p-4"}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Bloque {s.b}</span>
                <Badge variant={s.done ? "success" : "muted"}>{s.done ? "Disponible" : "Próximamente"}</Badge>
              </div>
              <p className="mt-2 font-semibold">{s.t}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Stat({ label, value, loading }: { label: string; value?: number | undefined; loading: boolean }) {
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
}: {
  icon: typeof FolderTree;
  label: string;
  value?: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl bg-graphite-soft p-4">
      <Icon className="size-4 text-primary" aria-hidden />
      <p className="mt-3 text-3xl font-bold tabular">{loading ? "…" : formatNumber(value ?? 0, 0)}</p>
      <p className="text-xs text-graphite-muted">{label}</p>
    </div>
  );
}
