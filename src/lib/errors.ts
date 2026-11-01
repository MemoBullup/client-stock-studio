// Traduce errores del servidor a mensajes claros en español.
export function friendlyError(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  if (!raw) return "Ocurrió un error inesperado. Intenta de nuevo.";
  if (/Failed to fetch|NetworkError|network/i.test(raw))
    return "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo; lo capturado se conserva.";
  if (/Invalid login credentials/i.test(raw)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(raw)) return "La cuenta aún no está confirmada.";
  if (/duplicate key value.*categories_unique_name|locations_unique_name/i.test(raw))
    return "Ya existe un elemento con ese nombre en el mismo nivel.";
  if (/duplicate key/i.test(raw)) return "Ese registro ya existe.";
  if (/violates foreign key constraint/i.test(raw))
    return "No se puede completar: hay registros relacionados que dependen de este elemento.";
  if (/row-level security|permission denied/i.test(raw))
    return "No tienes permiso para realizar esta acción.";
  if (/pwned|weak.*password|password.*(short|weak)/i.test(raw))
    return "La contraseña es demasiado débil o aparece en filtraciones conocidas. Elige otra.";
  if (/User already registered|already been registered/i.test(raw))
    return "Ya existe una cuenta con ese correo.";
  if (/Unauthorized/i.test(raw)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  return raw;
}
