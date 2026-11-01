import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

// Secciones exclusivas del Administrador. La base de datos vuelve a validar cada operación.
export const Route = createFileRoute("/_authenticated/_admin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw redirect({ to: "/auth" });
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw redirect({ to: "/inicio" });
  },
  component: () => <Outlet />,
});
