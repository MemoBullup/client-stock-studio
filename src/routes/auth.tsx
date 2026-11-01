import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, LockKeyhole, Mail, QrCode, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { safeRedirect } from "@/lib/redirect";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Iniciar sesión · Aly Inventario" },
      { name: "description", content: "Acceso para el personal autorizado de Aly — Creaciones con estilo." },
      { property: "og:title", content: "Iniciar sesión · Aly Inventario" },
      { property: "og:description", content: "Acceso para el personal autorizado de Aly — Creaciones con estilo." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Escribe un correo válido").max(255);

function AuthPage() {
  const { redirect } = Route.useSearch();
  const target = safeRedirect(redirect);
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: target, replace: true });
    });
  }, [navigate, target]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) next.email = parsed.error.issues[0]?.message ?? "Correo inválido";
    if (!password) next.password = "Escribe tu contraseña";
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data!, password });
    setLoading(false);
    if (error) {
      setErrors({ form: friendlyError(error) });
      return;
    }
    navigate({ to: target, replace: true });
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setErrors({ email: parsed.error.issues[0]?.message ?? "Correo inválido" });
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setErrors({ form: friendlyError(error) });
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-6xl gap-4 sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[1.1fr_1fr]">
        <aside className="surface-graphite relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
          <BrandLogo tone="light" className="h-24 w-auto self-start" />
          <div>
            <h1 className="text-4xl font-bold leading-tight">
              Inventario <span className="text-primary">claro</span>,
              <br /> captura rápida.
            </h1>
            <p className="mt-3 max-w-md text-sm text-graphite-muted">
              Registra listones, aplicaciones y productos impresos con su SKU, ubicación y QR en
              segundos.
            </p>
            <ul className="mt-8 grid gap-3 text-sm">
              {[
                { icon: Tags, text: "SKU único generado por el servidor" },
                { icon: QrCode, text: "QR y etiquetas para cada variante" },
                { icon: ShieldCheck, text: "Permisos reales para Administrador y Editor" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-1.5" aria-hidden>
            <span className="progress-stripes h-2 w-24 rounded-full" />
            <span className="h-2 w-10 rounded-full bg-graphite-soft" />
            <span className="h-2 w-6 rounded-full bg-graphite-soft" />
          </div>
        </aside>

        <section className="surface-card flex flex-col justify-center p-6 sm:p-12">
          <BrandLogo className="mx-auto mb-8 h-20 w-auto lg:hidden" />
          <div className="mx-auto w-full max-w-sm">
            {mode === "login" ? (
              <>
                <h2 className="text-3xl font-bold tracking-tight">Iniciar sesión</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  El acceso es solo para cuentas autorizadas. Si aún no tienes una, pídesela al
                  Administrador.
                </p>
                <form onSubmit={onLogin} className="mt-8 grid gap-5" noValidate>
                  <Field
                    id="email"
                    label="Correo electrónico"
                    icon={<Mail className="size-4" />}
                    error={errors.email}
                  >
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      className="h-12 rounded-2xl pl-10"
                      autoFocus
                    />
                  </Field>
                  <Field
                    id="password"
                    label="Contraseña"
                    icon={<LockKeyhole className="size-4" />}
                    error={errors.password}
                  >
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? "password-error" : undefined}
                      className="h-12 rounded-2xl pl-10"
                    />
                  </Field>
                  {errors.form && (
                    <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {errors.form}
                    </p>
                  )}
                  <Button type="submit" size="lg" disabled={loading} className="w-full">
                    {loading && <Loader2 className="animate-spin" />} Entrar
                  </Button>
                  <button
                    type="button"
                    className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setErrors({});
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-3xl font-bold tracking-tight">Recuperar acceso</h2>
                {sent ? (
                  <div className="mt-6 rounded-2xl bg-success-soft p-5 text-sm">
                    <CheckCircle2 className="mb-2 size-5 text-success" aria-hidden />
                    Si el correo pertenece a una cuenta autorizada, recibirás un enlace para crear una
                    nueva contraseña. Revisa también la carpeta de spam.
                  </div>
                ) : (
                  <form onSubmit={onForgot} className="mt-8 grid gap-5" noValidate>
                    <p className="text-sm text-muted-foreground">
                      Escribe tu correo y te enviaremos un enlace para restablecer la contraseña.
                    </p>
                    <Field id="email-f" label="Correo electrónico" icon={<Mail className="size-4" />} error={errors.email}>
                      <Input
                        id="email-f"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        aria-invalid={!!errors.email}
                        className="h-12 rounded-2xl pl-10"
                        autoFocus
                      />
                    </Field>
                    {errors.form && (
                      <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {errors.form}
                      </p>
                    )}
                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                      {loading && <Loader2 className="animate-spin" />} Enviar enlace
                    </Button>
                  </form>
                )}
                <button
                  type="button"
                  className="mt-5 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode("login");
                    setSent(false);
                    setErrors({});
                  }}
                >
                  Volver a iniciar sesión
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
