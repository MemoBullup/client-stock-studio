// QR estables por variante: la URL solo lleva el identificador interno (nunca costos ni cantidades).
import QRCode from "qrcode";

/** Máximo de etiquetas por lote (solo Administrador). */
export const MAX_BATCH_LABELS = 500;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** URL que se codifica en el QR: <base>/q/<id>. Sin base configurada, usa la dirección actual. */
export function qrUrl(baseUrl: string | null | undefined, variantId: string, fallbackOrigin = ""): string {
  const base = (baseUrl?.trim() || fallbackOrigin).replace(/\/+$/, "");
  return `${base}/q/${variantId}`;
}

/** Direcciones de vista previa o locales: no deben imprimirse en etiquetas definitivas. */
export function isTemporaryUrl(url: string): boolean {
  return /id-preview|lovableproject\.com|localhost|127\.0\.0\.1/i.test(url);
}

/** Extrae el id de variante de un texto escaneado (URL /q/<id> o /inventario/<id>). */
export function variantIdFromScan(text: string): string | null {
  const m = text.trim().match(new RegExp(`/(?:q|inventario)/(${UUID})(?:[/?#]|$)`, "i"));
  if (m?.[1]) return m[1].toLowerCase();
  const bare = text.trim().match(new RegExp(`^(${UUID})$`, "i"));
  return bare?.[1]?.toLowerCase() ?? null;
}

/** Matriz del QR como un único trazo SVG (un cuadro por módulo), con zona de silencio. */
export function qrPath(text: string, quiet = 2): { size: number; path: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (data[r * n + c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, path };
}

export async function qrPngDataUrl(text: string, px = 600): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: px });
}
