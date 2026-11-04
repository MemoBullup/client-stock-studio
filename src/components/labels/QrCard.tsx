import { Link } from "@tanstack/react-router";
import { Download, Printer, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { QrSvg } from "@/components/labels/QrSvg";
import { Button } from "@/components/ui/button";
import { useQrUrl } from "@/hooks/use-qr-url";
import { qrPngDataUrl } from "@/lib/qr";

/** QR de la ficha: misma URL estable al reimprimir; nunca cambia el identificador. */
export function QrCard({ variantId, sku }: { variantId: string; sku: string | null }) {
  const qr = useQrUrl();
  if (!sku) {
    return (
      <p className="mt-4 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        El QR y la etiqueta se generan cuando el registro se confirma y recibe su SKU.
      </p>
    );
  }
  const url = qr.urlFor(variantId);

  async function download() {
    try {
      const a = document.createElement("a");
      a.href = await qrPngDataUrl(url);
      a.download = `QR-${sku}.png`;
      a.click();
    } catch {
      toast.error("No se pudo generar la imagen del QR.");
    }
  }

  return (
    <div className="mt-4 rounded-2xl border p-3">
      <div className="flex gap-3">
        <QrSvg value={url} title={`QR de ${sku}`} className="size-28 shrink-0 rounded-lg" />
        <div className="min-w-0 text-xs">
          <p className="font-semibold">QR del SKU</p>
          <p className="mt-1 break-all text-muted-foreground">{url}</p>
          <p className="mt-1 text-muted-foreground">
            Abre esta ficha y pide iniciar sesión si hace falta.
          </p>
        </div>
      </div>
      {qr.temporary && (
        <p className="mt-2 flex gap-1.5 rounded-xl bg-warning-soft p-2 text-xs text-warning-foreground">
          <TriangleAlert className="size-3.5 shrink-0" /> Dirección temporal: no imprimas etiquetas
          definitivas todavía.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to="/etiquetas" search={{ ids: variantId }}>
            <Printer /> Imprimir etiqueta
          </Link>
        </Button>
        <Button size="sm" variant="outline" onClick={download}>
          <Download /> Descargar QR
        </Button>
      </div>
    </div>
  );
}
