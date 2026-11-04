import { useNavigate } from "@tanstack/react-router";
import { Download, Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQrUrl } from "@/hooks/use-qr-url";
import type { CatalogFilters } from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { MAX_BATCH_LABELS } from "@/lib/qr";
import { exportReport, fetchFilteredIds } from "@/lib/reports.fetch";

/** Acciones del Administrador sobre TODOS los resultados filtrados (no solo la página visible). */
export function BulkActions({ filters, total }: { filters: CatalogFilters; total: number }) {
  const qr = useQrUrl();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  async function doExport(format: "csv" | "xlsx", includeCosts: boolean) {
    setBusy("export");
    try {
      const ids = await fetchFilteredIds(filters);
      const n = await exportReport({
        kind: "ids",
        ids,
        format,
        includeCosts,
        fileBase: "resultado-de-filtros",
        title: "Resultado de filtros",
        qrUrlFor: qr.urlFor,
      });
      toast.success(`Se descargaron ${formatNumber(n, 0)} SKU filtrados.`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function labels() {
    if (total > MAX_BATCH_LABELS) {
      toast.error(`Son ${formatNumber(total, 0)} SKU. Filtra hasta ${MAX_BATCH_LABELS} para imprimir sus etiquetas en un lote.`);
      return;
    }
    setBusy("labels");
    try {
      const ids = await fetchFilteredIds({ ...filters, registro: filters.registro ?? "registered" });
      if (!ids.length) {
        toast.error("No hay SKU confirmados en estos resultados.");
        return;
      }
      navigate({ to: "/etiquetas", search: { ids: ids.join(",") } });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={!!busy || total === 0}>
            {busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 rounded-2xl">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {formatNumber(total, 0)} SKU con los filtros actuales
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => doExport("xlsx", false)}>Excel sin costos</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => doExport("csv", false)}>CSV sin costos</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => doExport("xlsx", true)}>Excel con costos</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => doExport("csv", true)}>CSV con costos</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" onClick={labels} disabled={!!busy || total === 0}>
        {busy === "labels" ? <Loader2 className="animate-spin" /> : <Printer />} Etiquetas
      </Button>
    </>
  );
}
