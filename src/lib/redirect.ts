/** Acepta solo rutas internas ("/algo"), nunca URLs externas. */
export function safeRedirect(value: unknown, fallback = "/inicio"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/auth")) return fallback;
  return value;
}
