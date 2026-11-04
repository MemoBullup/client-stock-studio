import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Nueva contraseña · Aly Inventario" },
      {
        name: "description",
        content: "Crea una nueva contraseña para tu cuenta de Aly Inventario.",
      },
      { property: "og:title", content: "Nueva contraseña · Aly Inventario" },
      {
        property: "og:description",
        content: "Crea una nueva contraseña para tu cuenta de Aly Inventario.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session || isRecovery) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) return setError(friendlyError(err));
    toast.success("Contraseña actualizada");
    navigate({ to: "/inicio", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="surface-card w-full max-w-md p-8">
        <BrandLogo className="mx-auto mb-6 h-16 w-auto" />
        <h1 className="text-2xl font-bold">Crear nueva contraseña</h1>
        {!ready ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Abre esta página desde el enlace que llegó a tu correo. Si el enlace expiró, solicita
            uno nuevo desde la pantalla de acceso.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="pw">Nueva contraseña</Label>
              <Input
                id="pw"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-2xl"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pw2">Confirmar contraseña</Label>
              <Input
                id="pw2"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-12 rounded-2xl"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />} Guardar contraseña
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
