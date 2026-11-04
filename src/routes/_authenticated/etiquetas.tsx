import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Printer, TriangleAlert } from "lucide-react";

import { LabelCard, type LabelInfo } from "@/components/labels/LabelCard";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useQrUrl } from "@/hooks/use-qr-url";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { MAX_BATCH_LABELS } from "@/lib/qr";
import { useMe, useSettings } from "@/lib/session";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LabelSearch {
  ids?: string | undefined;
  formato?: "rollo" | "carta" | undefined;
}

export const Route = createFileRoute("/_authenticated/etiquetas")({
  validateSearch: (s: Record<string, unknown>): LabelSearch => ({
    ids: typeof s["ids"] === "string" ? s["ids"] : undefined,
    formato: s["formato"] === "carta" ? "carta" : s["formato"] === "rollo" ? "rollo" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Etiquetas · Aly Inventario" },
      { name: "description", content: "Vista previa e impresión de etiquetas con QR por SKU." },
      { property: "og:title", content: "Etiquetas · Aly Inventario" },
      {
        property: "og:description",
        content: "Vista previa e impresión de etiquetas con QR por SKU.",
      },
    ],
  }),
  component: EtiquetasPage,
});

function EtiquetasPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const qr = useQrUrl();
  const isAdmin = me?.role === "admin";
  const formato = search.formato ?? "rollo";
  const ids = Array.from(
    new Set(
      (search.ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ).slice(0, MAX_BATCH_LABELS);
  const batchBlocked = !isAdmin && ids.length > 1;

  const labels = useQuery({
    queryKey: ["labels", ids],
    enabled: ids.length > 0 && !batchBlocked,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("label_data", { _ids: ids });
      if (error) throw error;
      return (data ?? []) as Array<LabelInfo & { record_status: string }>;
    },
  });

  const w = Number(settings?.label_width_mm ?? 50);
  const h = Number(settings?.label_height_mm ?? 25);
  const printable = (labels.data ?? []).filter((l) => l.sku && l.record_status !== "draft");
  const skipped = (labels.data?.length ?? 0) - printable.length;

  const pageCss =
    formato === "rollo"
      ? `@page { size: ${w}mm ${h}mm; margin: 0; } @media print { .label-card { border: none !important; border-radius: 0 !important; break-after: page; } }`
      : `@page { size: letter; margin: 8mm; } @media print { .label-card { border-color: #0002 !important; } }`;

  return (
    <div className="space-y-5">
      <style>{pageCss}</style>
      <div className="print:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => router.history.back()}
        >
          <ArrowLeft /> Volver
        </Button>
        <PageHeader
          title={ids.length > 1 ? `Etiquetas (${formatNumber(ids.length, 0)})` : "Etiqueta"}
          description={`Tamaño configurado: ${formatNumber(w)} × ${formatNumber(h)} mm. El QR abre la ficha del SKU y siempre pide iniciar sesión.`}
          actions={
            <Button size="lg" onClick={() => window.print()} disabled={printable.length === 0}>
              <Printer /> Imprimir
            </Button>
          }
        />
        <div
          className="flex flex-wrap items-center gap-2"
          role="radiogroup"
          aria-label="Formato de impresión"
        >
          {(
            [
              ["rollo", "Impresora de etiquetas (una por hoja)"],
              ["carta", "Hoja carta (varias por hoja)"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={formato === value}
              onClick={() => navigate({ search: { ...search, formato: value }, replace: true })}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition",
                formato === value
                  ? "border-transparent bg-graphite text-graphite-foreground"
                  : "bg-card hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
          {isAdmin && (
            <Link
              to="/usuarios"
              className="ml-auto text-sm font-semibold underline underline-offset-2"
            >
              Cambiar tamaño de etiqueta
            </Link>
          )}
        </div>
        {qr.temporary && (
          <p
            className="mt-3 flex gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning-foreground"
            role="alert"
          >
            <TriangleAlert className="size-4 shrink-0" />
            {qr.configured
              ? "La URL base de los QR parece temporal o de vista previa."
              : "Aún no hay URL base de producción para los QR; se usa la dirección actual."}{" "}
            No imprimas etiquetas definitivas hasta configurar el dominio final en Configuración.
          </p>
        )}
      </div>

      {ids.length === 0 ? (
        <Empty>No se eligió ningún SKU. Abre una ficha y usa «Imprimir etiqueta».</Empty>
      ) : batchBlocked ? (
        <Empty>
          La impresión por lotes es exclusiva del Administrador. Abre cada ficha para imprimir su
          etiqueta individual.
        </Empty>
      ) : labels.isLoading ? (
        <div
          className="surface-card flex items-center gap-2 p-6 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" /> Preparando etiquetas…
        </div>
      ) : labels.isError ? (
        <Empty>{friendlyError(labels.error)}</Empty>
      ) : printable.length === 0 ? (
        <Empty>Los borradores no tienen SKU todavía: confírmalos para imprimir su etiqueta.</Empty>
      ) : (
        <>
          {skipped > 0 && (
            <p className="text-sm text-muted-foreground print:hidden">
              Se omitieron {skipped} borrador(es) sin SKU.
            </p>
          )}
          <div className="surface-card overflow-auto p-4 sm:p-6 print:overflow-visible print:rounded-none print:border-none print:p-0 print:shadow-none">
            <div
              className={cn(
                "print-area flex flex-wrap",
                formato === "rollo" ? "gap-4 print:gap-0" : "gap-[2mm]",
              )}
            >
              {printable.map((l) => (
                <LabelCard key={l.id} info={l} url={qr.urlFor(l.id)} widthMm={w} heightMm={h} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-card p-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}
