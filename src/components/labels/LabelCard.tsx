import { QrSvg } from "@/components/labels/QrSvg";

export interface LabelInfo {
  id: string;
  sku: string | null;
  product_name: string;
  variant_label: string | null;
  defining_text: string | null;
  details: string | null;
}

/**
 * Etiqueta física en milímetros: QR legible, SKU en texto, nombre corto y
 * características principales. Nunca incluye costos ni cantidades.
 */
export function LabelCard({
  info,
  url,
  widthMm,
  heightMm,
}: {
  info: LabelInfo;
  url: string;
  widthMm: number;
  heightMm: number;
}) {
  const pad = Math.max(1.5, Math.min(widthMm, heightMm) * 0.06);
  const horizontal = widthMm >= heightMm * 1.25;
  const qrSide = horizontal
    ? heightMm - pad * 2
    : Math.min(widthMm - pad * 2, heightMm * 0.58);
  const textH = horizontal ? heightMm - pad * 2 : heightMm - qrSide - pad * 3;
  const sku = Math.max(2.2, Math.min(textH * 0.2, horizontal ? (widthMm - qrSide) * 0.11 : widthMm * 0.09));
  const small = Math.max(1.7, sku * 0.62);
  const line2 = info.variant_label ?? info.defining_text;

  return (
    <div
      className="label-card flex overflow-hidden rounded-[1mm] border border-foreground/15 bg-card text-foreground"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        padding: `${pad}mm`,
        gap: `${pad}mm`,
        flexDirection: horizontal ? "row" : "column",
        alignItems: horizontal ? "center" : "stretch",
        breakInside: "avoid",
      }}
    >
      <QrSvg
        value={url}
        title={`QR de ${info.sku ?? "SKU"}`}
        className="shrink-0 self-center"
        // El tamaño en mm hace que el QR se imprima a escala real.
        style={{ width: `${qrSide}mm`, height: `${qrSide}mm` }}
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center" style={{ gap: `${small * 0.25}mm` }}>
        <p className="font-mono font-bold leading-none" style={{ fontSize: `${sku}mm` }}>
          {info.sku ?? "SIN SKU"}
        </p>
        <p className="line-clamp-2 font-semibold leading-tight" style={{ fontSize: `${small}mm` }}>
          {info.product_name}
        </p>
        {line2 && (
          <p className="line-clamp-1 leading-tight" style={{ fontSize: `${small}mm` }}>
            {line2}
          </p>
        )}
        {info.details && (
          <p className="line-clamp-1 leading-tight opacity-80" style={{ fontSize: `${small * 0.9}mm` }}>
            {info.details}
          </p>
        )}
      </div>
    </div>
  );
}
