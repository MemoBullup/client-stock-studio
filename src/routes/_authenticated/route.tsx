import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { data: me, isLoading, isError, refetch } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }

  if (isError || !me) {
    return (
      <CenteredCard>
        <h1 className="text-xl font-bold">No pudimos cargar tu cuenta</h1>
        <p className="mt-2 text-sm text-muted-foreground">Revisa tu conexión e intenta de nuevo.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => refetch()}>Reintentar</Button>
          <Button variant="outline" onClick={signOut}>
            Cerrar sesión
          </Button>
        </div>
      </CenteredCard>
    );
  }

  if (!me.role || !me.isActive) {
    return (
      <CenteredCard>
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning-foreground">
          <ShieldAlert className="size-6" aria-hidden />
        </div>
        <h1 className="text-xl font-bold">
          {me.isActive ? "Cuenta pendiente de autorización" : "Cuenta desactivada"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {me.isActive
            ? "Tu cuenta existe, pero todavía no tiene un rol asignado. Pide al Administrador que te asigne el rol de Editor o Administrador."
            : "El Administrador desactivó el acceso de esta cuenta. Comunícate con él si crees que es un error."}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Sesión iniciada como {me.email}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            Ya me asignaron un rol
          </Button>
          <Button variant="graphite" onClick={signOut}>
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </CenteredCard>
    );
  }

  return (
    <AppShell me={me}>
      <Outlet />
    </AppShell>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="surface-card w-full max-w-md p-8 text-center">
        <BrandLogo className="mx-auto mb-6 h-16 w-auto" />
        {children}
      </div>
    </div>
  );
}
