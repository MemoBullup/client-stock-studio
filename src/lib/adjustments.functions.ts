import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { proposeAdjustment as proposeAdjustmentServer } from "@/lib/adjustments.server";

const schema = z.object({
  text: z
    .string()
    .trim()
    .min(5, "Describe el ajuste con un poco más de detalle")
    .max(1000, "Máximo 1000 caracteres"),
});

/** Propone SKU, ubicación y cantidad a partir de texto libre. No modifica datos. */
export const proposeAdjustment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isStaff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!isStaff) throw new Error("Tu cuenta no tiene acceso al inventario");
    return proposeAdjustmentServer(context.supabase, data.text);
  });
