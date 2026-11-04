import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSpreadsheet, FileText, Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useQrUrl } from "@/hooks/use-qr-url";
import { friendlyError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { REPORTS, type ReportKind } from "@/lib/reports";
import { exportReport } from "@/lib/reports.fetch";

export const Route = createFileRoute("/_authenticated/_admin/informes")({
  head: () => ({
    meta: [
      { title: "Informes · Aly Inventario" },
      {
        name: "description",
        content: "Descarga el catálogo y los informes de inventario en CSV o Excel.",
      },
      { property: "og:title", content: "Informes · Aly Inventario" },
      {
        property: "og:description",
        content: "Descarga el catálogo y los informes de inventario en CSV o Excel.",
      },
    ],
  }),
  component: InformesPage,
});

function InformesPage() {
  const qr = useQrUrl();
  const [includeCosts, setIncludeCosts] = useState(false);
  const [busy, setBusy] = useState<{
    kind: ReportKind;
    format: string;
    done: number;
    total: number;
  } | null>(null);

  async function run(
    kind: Exclude<ReportKind, "ids">,
    format: "csv" | "xlsx",
    title: string,
    file: string,
  ) {
    setBusy({ kind, format, done: 0, total: 0 });
    try {
      const n = await exportReport({
        kind,
        format,
        includeCosts,
        fileBase: file,
        title,
        qrUrlFor: qr.urlFor,
        onProgress: (done, total) => setBusy({ kind, format, done, total }),
      });
      toast.success(
        n === 0
          ? `«${title}» no tiene registros; se descargó vacío.`
          : `Se descargaron ${formatNumber(n, 0)} filas de «${title}».`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Informes"
        description="Descargas exclusivas del Administrador en CSV (UTF-8) o Excel. Incluyen todos los registros, no solo una página."
      />

      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-3xl bg-gold-soft p-4 text-sm">
        <label className="flex items-center gap-3 font-semibold">
          <Switch
            checked={includeCosts}
            onCheckedChange={setIncludeCosts}
            aria-label="Incluir costos"
          />
          Incluir costos y valor estimado
        </label>
        <span className="text-gold-foreground">
          {includeCosts
            ? "El archivo tendrá información económica privada. Compártelo con cuidado."
            : "Sin costos: apto para compartir con el equipo."}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((r) => {
          const mine = busy?.kind === r.kind;
          return (
            <section
              key={r.kind}
              className="surface-card flex flex-col p-5"
              aria-labelledby={`rep-${r.kind}`}
            >
              <h2 id={`rep-${r.kind}`} className="text-lg font-bold">
                {r.title}
              </h2>
              <p className="mt-1 flex-1 text-sm text-muted-foreground">{r.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={() => run(r.kind, "xlsx", r.title, r.file)} disabled={!!busy}>
                  {mine && busy?.format === "xlsx" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FileSpreadsheet />
                  )}{" "}
                  Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => run(r.kind, "csv", r.title, r.file)}
                  disabled={!!busy}
                >
                  {mine && busy?.format === "csv" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FileText />
                  )}{" "}
                  CSV
                </Button>
                {mine && busy.total > 0 && (
                  <span className="text-xs text-muted-foreground tabular" role="status">
                    {formatNumber(busy.done, 0)} de {formatNumber(busy.total, 0)}
                  </span>
                )}
              </div>
            </section>
          );
        })}
        <section className="surface-sky flex flex-col p-5">
          <h2 className="text-lg font-bold">Resultado de filtros</h2>
          <p className="mt-1 flex-1 text-sm">
            Filtra en Inventario (categoría, ubicación, existencia, foto, capturista…) y usa
            «Exportar» para descargar todos los resultados, no solo la página visible.
          </p>
          <Button variant="graphite" className="mt-4 self-start" asChild>
            <Link to="/inventario" search={{}}>
              Ir a Inventario
            </Link>
          </Button>
        </section>
      </div>

      <p className="mt-5 flex gap-2 text-xs text-muted-foreground">
        <Info className="size-4 shrink-0" />
        Los archivos no incluyen datos de acceso ni información interna de seguridad. Los costos
        desconocidos aparecen como «Costo pendiente», nunca como cero. Los registros DEMO se marcan
        en la columna «Demo».
      </p>
    </>
  );
}
