import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useSettings } from "@/lib/session";

const schema = z.object({
  business_name: z.string().trim().min(1, "Obligatorio").max(80),
  business_tagline: z.string().trim().max(120),
  contact_info: z.string().trim().max(500),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Código de 3 letras, ej. MXN"),
  sku_prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, "Solo letras, números y guiones (máx. 10)"),
  sku_digits: z.coerce.number().int().min(4).max(10),
  sku_goal: z.coerce.number().int().min(1, "Debe ser mayor a 0"),
  qr_base_url: z
    .string()
    .trim()
    .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), "Debe iniciar con https://"),
  max_category_depth: z.coerce.number().int().min(1).max(8),
  label_width_mm: z.coerce.number().min(15).max(200),
  label_height_mm: z.coerce.number().min(10).max(200),
  is_demo_environment: z.boolean(),
});

type FormState = z.input<typeof schema>;

export function SettingsPanel() {
  const { data: settings, isLoading } = useSettings();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        business_name: settings.business_name,
        business_tagline: settings.business_tagline ?? "",
        contact_info: settings.contact_info ?? "",
        currency: settings.currency,
        sku_prefix: settings.sku_prefix,
        sku_digits: settings.sku_digits,
        sku_goal: settings.sku_goal,
        qr_base_url: settings.qr_base_url ?? "",
        max_category_depth: settings.max_category_depth,
        label_width_mm: Number(settings.label_width_mm),
        label_height_mm: Number(settings.label_height_mm),
        is_demo_environment: settings.is_demo_environment,
      });
    }
  }, [settings, form]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["settings"] });
    qc.invalidateQueries({ queryKey: ["branding"] });
  };

  const save = useMutation({
    mutationFn: async (values: z.output<typeof schema>) => {
      const { error } = await supabase
        .from("app_settings")
        .update({
          ...values,
          business_tagline: values.business_tagline || null,
          contact_info: values.contact_info || null,
          qr_base_url: values.qr_base_url ? values.qr_base_url.replace(/\/+$/, "") : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuración guardada");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type))
        throw new Error("Usa una imagen PNG, JPG o WEBP.");
      if (file.size > 5 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 5 MB.");
      const ext = (file.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
      const path = `logo/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from("branding")
        .upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await supabase.from("app_settings").update({ logo_path: path }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Logotipo actualizado");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const resetLogo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("app_settings").update({ logo_path: null }).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Se restauró el logotipo original");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (isLoading || !form) {
    return (
      <div
        className="surface-card flex items-center gap-2 p-6 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-4 animate-spin" /> Cargando configuración…
      </div>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm({ ...form, [key]: value });
  const digits = Number(form.sku_digits) || 6;
  const skuPreview = `${String(form.sku_prefix).toUpperCase()}${"1".padStart(digits, "0")}`;
  const qrIsPreview = /id-preview|lovableproject|localhost/i.test(String(form.qr_base_url));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Revisa los campos marcados");
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-2" noValidate>
      <section className="surface-card grid gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-bold">Datos del negocio</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-muted p-4">
          <BrandLogo className="h-16 w-auto" />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo.mutate(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploadLogo.isPending}
            >
              {uploadLogo.isPending ? <Loader2 className="animate-spin" /> : <ImageUp />} Cambiar
              logotipo
            </Button>
            {settings?.logo_path && (
              <Button type="button" variant="ghost" size="sm" onClick={() => resetLogo.mutate()}>
                <RotateCcw /> Usar logotipo original
              </Button>
            )}
          </div>
        </div>
        <Field id="s-name" label="Nombre del negocio" error={errors.business_name}>
          <Input
            id="s-name"
            value={form.business_name}
            onChange={(e) => set("business_name", e.target.value)}
          />
        </Field>
        <Field id="s-tag" label="Lema" error={errors.business_tagline}>
          <Input
            id="s-tag"
            value={form.business_tagline}
            onChange={(e) => set("business_tagline", e.target.value)}
          />
        </Field>
        <Field id="s-contact" label="Datos de contacto (opcional)" error={errors.contact_info}>
          <Textarea
            id="s-contact"
            rows={2}
            value={form.contact_info}
            onChange={(e) => set("contact_info", e.target.value)}
          />
        </Field>
        <Field
          id="s-cur"
          label="Moneda"
          hint="Código ISO de 3 letras. Formato regional: México."
          error={errors.currency}
        >
          <Input
            id="s-cur"
            value={form.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
            maxLength={3}
            className="w-28 uppercase"
          />
        </Field>
        <label className="flex items-start gap-3 rounded-2xl bg-brand-pink-soft p-4 text-sm">
          <Switch
            checked={form.is_demo_environment}
            onCheckedChange={(v) => set("is_demo_environment", v)}
          />
          <span>
            <strong>Mostrar aviso de entorno de demostración.</strong> Desactívalo cuando se retiren
            los datos ficticios y se trabaje solo con el inventario real.
          </span>
        </label>
      </section>

      <section className="surface-card grid content-start gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-bold">SKU, QR y etiquetas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="s-prefix"
            label="Prefijo de SKU"
            hint="Aplica a nuevas altas. Los SKU existentes no cambian."
            error={errors.sku_prefix}
          >
            <Input
              id="s-prefix"
              value={form.sku_prefix}
              onChange={(e) => set("sku_prefix", e.target.value.toUpperCase())}
              className="font-mono uppercase"
            />
          </Field>
          <Field id="s-digits" label="Dígitos del consecutivo" error={errors.sku_digits}>
            <Input
              id="s-digits"
              type="number"
              min={4}
              max={10}
              value={form.sku_digits}
              onChange={(e) => set("sku_digits", Number(e.target.value))}
            />
          </Field>
        </div>
        <p className="rounded-2xl bg-graphite px-4 py-3 font-mono text-sm text-graphite-foreground">
          Formato: <span className="text-primary">{skuPreview}</span>
        </p>
        <Field
          id="s-qr"
          label="URL base para los QR"
          hint="Usa el dominio definitivo de producción antes de imprimir etiquetas. Si se deja vacío, se usará la dirección actual."
          error={errors.qr_base_url}
        >
          <Input
            id="s-qr"
            value={form.qr_base_url}
            onChange={(e) => set("qr_base_url", e.target.value)}
            placeholder="https://inventario.tudominio.com"
          />
        </Field>
        {qrIsPreview && (
          <p className="flex gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning-foreground">
            <TriangleAlert className="size-4 shrink-0" /> Esta dirección parece temporal o de vista
            previa. No imprimas etiquetas definitivas con ella.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-lw" label="Ancho de etiqueta (mm)" error={errors.label_width_mm}>
            <Input
              id="s-lw"
              type="number"
              value={form.label_width_mm}
              onChange={(e) => set("label_width_mm", Number(e.target.value))}
            />
          </Field>
          <Field id="s-lh" label="Alto de etiqueta (mm)" error={errors.label_height_mm}>
            <Input
              id="s-lh"
              type="number"
              value={form.label_height_mm}
              onChange={(e) => set("label_height_mm", Number(e.target.value))}
            />
          </Field>
        </div>
        <h2 className="mt-2 text-lg font-bold">Levantamiento</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-goal" label="Meta de SKU" error={errors.sku_goal}>
            <Input
              id="s-goal"
              type="number"
              min={1}
              value={form.sku_goal}
              onChange={(e) => set("sku_goal", Number(e.target.value))}
            />
          </Field>
          <Field
            id="s-depth"
            label="Niveles máximos de categoría"
            error={errors.max_category_depth}
          >
            <Input
              id="s-depth"
              type="number"
              min={1}
              max={8}
              value={form.max_category_depth}
              onChange={(e) => set("max_category_depth", Number(e.target.value))}
            />
          </Field>
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex justify-end lg:col-span-2">
        <Button type="submit" size="lg" disabled={save.isPending} className="shadow-float">
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Guardar configuración
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
