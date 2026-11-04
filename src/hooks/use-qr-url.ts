import { isTemporaryUrl, qrUrl } from "@/lib/qr";
import { useSettings } from "@/lib/session";

/** Construye la URL del QR con la URL base configurada (o la dirección actual si no hay). */
export function useQrUrl() {
  const { data: settings } = useSettings();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const base = settings?.qr_base_url?.trim() || origin;
  return {
    base,
    configured: !!settings?.qr_base_url?.trim(),
    temporary: isTemporaryUrl(base),
    urlFor: (variantId: string) => qrUrl(settings?.qr_base_url, variantId, origin),
  };
}
