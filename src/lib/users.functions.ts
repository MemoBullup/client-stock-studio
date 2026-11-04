import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Correo inválido").max(255),
  fullName: z.string().trim().min(2, "Escribe el nombre").max(120),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
  role: z.enum(["admin", "editor"]),
});

const resetSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
});

/** Crea una cuenta autorizada (el registro público está desactivado). */
export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Solo un Administrador puede gestionar usuarios");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "No se pudo crear la cuenta");
    }
    const newId = created.data.user.id;
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: newId, email: data.email, full_name: data.fullName }, { onConflict: "id" });
    const roleRes = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: newId, role: data.role, assigned_by: context.userId },
        { onConflict: "user_id" },
      );
    if (roleRes.error) throw new Error(roleRes.error.message);
    return { id: newId };
  });

/** El Administrador asigna una contraseña temporal a otra cuenta. */
export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Solo un Administrador puede gestionar usuarios");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });
