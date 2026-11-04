import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Copy,
  ImageOff,
  Loader2,
  MapPin,
  MessageSquareWarning,
  Pencil,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CountDialog, type CountTarget } from "@/components/capture/CountDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { categoriesQuery, locationsQuery, PHOTO_LABEL, RECORD_LABEL, staffQuery, treePath, unitsQuery } from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useMe, useSettings } from "@/lib/session";
import { computeAdjustment, parseMinimum, type AdjustmentMode } from "@/lib/stock";

export const Route = createFileRoute("/_authenticated/inventario/$variantId")({
  head: () => ({
    meta: [
      { title: "Ficha del SKU · Aly Inventario" },
      { name: "description", content: "Ficha completa del SKU: características, existencias por ubicación e historial." },
      { property: "og:title", content: "Ficha del SKU · Aly Inventario" },
      { property: "og:description", content: "Ficha completa del SKU: características, existencias por ubicación e historial." },
    ],
  }),
  component: FichaPage,
});

const COUNT_STATUS = { confirmed: "Confirmado", in_review: "En revisión", rejected: "Descartado" } as const;

function useVariant(id: string, isAdmin: boolean) {
  return useQuery({
    queryKey: ["variant", id, isAdmin],
    queryFn: async () => {
      const { data: v, error } = await supabase.from("variants").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!v) return null;
      const [product, attrs, levels, counts, siblings, corrections, adjustments, cost] = await Promise.all([
        supabase.from("products").select("*, product_types(name)").eq("id", v.product_id).single(),
        supabase
          .from("variant_attribute_values")
          .select("attribute_id, value_state, value_text, value_number, value_options, unit_id, attributes(name, sort_order)")
          .eq("variant_id", id),
        supabase.from("stock_levels").select("location_id, quantity, counted_at, counted_by").eq("variant_id", id),
        supabase
          .from("stock_counts")
          .select("id, location_id, quantity, full_presentations, loose_quantity, conversion_factor, status, capture_ref, counted_by, counted_at")
          .eq("variant_id", id)
          .order("counted_at", { ascending: false }),
        supabase.from("variants").select("id, sku, variant_label, record_status").eq("product_id", v.product_id).neq("id", id).order("sku"),
        supabase.from("correction_requests").select("id, message, status, resolution_note, requested_by, created_at").eq("variant_id", id).order("created_at", { ascending: false }),
        isAdmin
          ? supabase.from("stock_adjustments").select("id, location_id, previous_quantity, new_quantity, reason, created_by, created_at").eq("variant_id", id).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        isAdmin ? supabase.from("variant_costs").select("cost_per_base_unit, currency, updated_at").eq("variant_id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      for (const r of [product, attrs, levels, counts, siblings, corrections, adjustments, cost]) if (r.error) throw r.error;
      return {
        variant: v,
        product: product.data!,
        attrs: (attrs.data ?? []).sort((a, b) => (a.attributes?.sort_order ?? 0) - (b.attributes?.sort_order ?? 0)),
        levels: levels.data ?? [],
        counts: counts.data ?? [],
        siblings: siblings.data ?? [],
        corrections: corrections.data ?? [],
        adjustments: adjustments.data ?? [],
        cost: cost.data,
      };
    },
  });
}

function FichaPage() {
  const { variantId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const isAdmin = me?.role === "admin";
  const { data, isLoading, isError, error, refetch } = useVariant(variantId, isAdmin);
  const { data: units = [] } = useQuery(unitsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: locations = [] } = useQuery(locationsQuery);
  const { data: staff = [] } = useQuery(staffQuery);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name || "—";

  const [countTarget, setCountTarget] = useState<CountTarget | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [adjustLoc, setAdjustLoc] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["variant", variantId] });
    qc.invalidateQueries({ queryKey: ["catalog", "search"] });
    qc.invalidateQueries({ queryKey: ["stock-alerts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const setReview = useMutation({
    mutationFn: async (status: "validated" | "pending") => {
      const { error } = await supabase.from("variants").update({ review_status: status }).eq("id", variantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estado de revisión actualizado");
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("variants").update({ record_status: "archived" }).eq("id", variantId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("SKU archivado. Su código no se reutilizará.");
      setArchiveOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const discard = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("discard_draft", { _variant_id: variantId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Borrador descartado");
      qc.invalidateQueries({ queryKey: ["catalog", "search"] });
      navigate({ to: "/inventario", search: {} });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (isLoading) {
    return (
      <div className="surface-card flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando ficha…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">{isError ? "No pudimos cargar la ficha" : "SKU no encontrado"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isError ? friendlyError(error) : "Puede que no exista, sea un borrador de otra persona o no tengas acceso."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {isError && <Button onClick={() => refetch()}>Reintentar</Button>}
          <Button variant="outline" asChild>
            <Link to="/inventario" search={{}}>Volver al inventario</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { variant: v, product: p } = data;
  const baseUnit = units.find((u) => u.id === v.base_unit_id);
  const presUnit = units.find((u) => u.id === v.presentation_unit_id);
  const qty = (n: number | null | undefined) =>
    n === null || n === undefined
      ? "Pendiente de conteo"
      : `${formatNumber(n, baseUnit?.allows_decimal === false ? 0 : 3)} ${n === 1 ? baseUnit?.name_singular ?? "" : baseUnit?.name_plural ?? ""}`;
  const total = data.levels.reduce((s, l) => s + Number(l.quantity), 0);
  const isDraft = v.record_status === "draft";
  const isOwnDraft = isDraft && v.created_by === me?.id;
  const isRegistered = v.record_status === "registered";
  const inReview = data.counts.filter((c) => c.status === "in_review");
  const currency = data.cost?.currency ?? settings?.currency ?? "MXN";

  function openCount() {
    setCountTarget({
      variantId: v.id,
      sku: v.sku,
      name: `${p.name}${v.variant_label ? ` · ${v.variant_label}` : ""}`,
      unitSingular: baseUnit?.name_singular ?? "",
      unitPlural: baseUnit?.name_plural ?? "",
      allowsDecimal: baseUnit?.allows_decimal ?? true,
      factor: v.units_per_presentation,
      presentationPlural: presUnit?.name_plural ?? null,
      countedLocationIds: data!.levels.map((l) => l.location_id),
    });
  }

  function attrText(a: (typeof data.attrs)[number]) {
    if (a.value_state === "pending") return <span className="text-warning-foreground">Dato pendiente</span>;
    if (a.value_state === "not_applicable") return <span className="text-muted-foreground">No aplica</span>;
    if (a.value_number !== null) {
      const u = units.find((x) => x.id === a.unit_id);
      return `${formatNumber(a.value_number, 3)}${u ? ` ${u.symbol ?? u.name_plural}` : ""}`;
    }
    if (a.value_options?.length) return a.value_options.join(", ");
    return a.value_text ?? "—";
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link to="/inventario" search={{}}>
            <ArrowLeft /> Inventario
          </Link>
        </Button>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground" title="Sin fotografía">
              <ImageOff className="size-6" aria-hidden />
              <span className="sr-only">Sin fotografía</span>
            </div>
            <div>
              <p className="font-mono text-sm font-bold">{v.sku ?? "Borrador sin SKU"}</p>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{p.name}</h1>
              {v.variant_label && <p className="text-lg text-muted-foreground">{v.variant_label}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={isDraft ? "muted" : isRegistered ? "graphite" : "outline"}>{RECORD_LABEL[v.record_status]}</Badge>
                <Badge variant={v.review_status === "validated" ? "success" : "info"}>
                  {v.review_status === "validated" ? "Validado" : "Revisión pendiente"}
                </Badge>
                <Badge variant={data.levels.length ? "success" : "warning"}>{data.levels.length ? "Conteo realizado" : "Pendiente de conteo"}</Badge>
                <Badge variant="muted">{PHOTO_LABEL[v.photo_status]}</Badge>
                {v.is_demo && <Badge variant="demo">DEMO</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isRegistered && (
              <Button onClick={openCount}>
                <MapPin /> Registrar conteo
              </Button>
            )}
            {(isOwnDraft || (isAdmin && v.record_status !== "archived")) && (
              <Button variant="outline" asChild>
                <Link to="/capturar" search={{ editar: v.id }}>
                  <Pencil /> {isDraft ? "Continuar borrador" : "Editar"}
                </Link>
              </Button>
            )}
            {v.record_status !== "archived" && (
              <Button variant="outline" asChild>
                <Link to="/capturar" search={{ producto: p.id }}>
                  <Plus /> Variante del mismo modelo
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setTemplateOpen(true)}>
              <Copy /> Duplicar como plantilla
            </Button>
            {!isAdmin && isRegistered && (
              <Button variant="outline" onClick={() => setCorrectionOpen(true)}>
                <MessageSquareWarning /> Solicitar corrección
              </Button>
            )}
            {isAdmin && isRegistered && (
              <Button variant="outline" onClick={() => setReview.mutate(v.review_status === "validated" ? "pending" : "validated")} disabled={setReview.isPending}>
                <BadgeCheck /> {v.review_status === "validated" ? "Marcar por revisar" : "Validar"}
              </Button>
            )}
            {isAdmin && isRegistered && (
              <Button variant="ghost" onClick={() => setArchiveOpen(true)}>
                <Archive /> Archivar
              </Button>
            )}
            {isDraft && (isOwnDraft || isAdmin) && (
              <Button variant="ghost" onClick={() => discard.mutate()} disabled={discard.isPending}>
                <Trash2 /> Descartar borrador
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="surface-card p-5 lg:col-span-2" aria-labelledby="exist-titulo">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="exist-titulo" className="text-lg font-bold">
              Existencias por ubicación
            </h2>
            <span className="text-sm">
              Total: <strong className="tabular">{data.levels.length ? qty(total) : "Pendiente de conteo"}</strong>
            </span>
          </div>
          {data.levels.length === 0 ? (
            <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
              {isRegistered ? "Todavía no se ha contado en ninguna ubicación." : "Los conteos se registran cuando el SKU se confirma."}
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border">
              {data.levels.map((l) => (
                <li key={l.location_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{treePath(locations, l.location_id)}</p>
                    <p className="text-xs text-muted-foreground">
                      Contó {nameOf(l.counted_by)} · {formatDateTime(l.counted_at)}
                    </p>
                  </div>
                  <span className="tabular font-semibold">{qty(Number(l.quantity))}</span>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" onClick={() => setAdjustLoc(l.location_id)}>
                      <Scale /> Ajustar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {inReview.length > 0 && (
            <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-foreground">
              {inReview.length} conteo(s) en revisión: no se sumaron.{" "}
              <Link to="/revisiones" className="font-semibold underline">
                {isAdmin ? "Revisar" : "Ver"}
              </Link>
            </div>
          )}
          {presUnit && (
            <p className="mt-3 text-xs text-muted-foreground">
              Presentación: {presUnit.name_singular}{" "}
              {v.units_per_presentation ? `de ${formatNumber(v.units_per_presentation)} ${baseUnit?.name_plural}` : "(contenido pendiente)"}
            </p>
          )}
        </section>

        <section className="surface-card p-5" aria-labelledby="gen-titulo">
          <h2 id="gen-titulo" className="mb-3 text-lg font-bold">
            Datos generales
          </h2>
          <dl className="space-y-2 text-sm">
            <Row label="Tipo">{p.product_types?.name ?? "—"}</Row>
            <Row label="Categoría">{treePath(categories, p.category_id) ?? <Badge variant="outline">Por clasificar</Badge>}</Row>
            <Row label="Unidad base">{baseUnit?.name_plural ?? "—"}</Row>
            <Row label="Código de proveedor">{v.supplier_code ?? "—"}</Row>
            <Row label="Código anterior">{v.legacy_code ?? "—"}</Row>
            <Row label="Usos">{p.usage_tags.length ? p.usage_tags.join(", ") : "—"}</Row>
            <Row label="Capturó">
              {nameOf(v.created_by)} · {formatDateTime(v.created_at)}
            </Row>
            {v.confirmed_at && <Row label="Confirmado">{formatDateTime(v.confirmed_at)}</Row>}
          </dl>
          {p.description && <p className="mt-3 text-sm">{p.description}</p>}
          {(v.notes || p.notes) && <p className="mt-2 text-sm text-muted-foreground">{v.notes ?? p.notes}</p>}
          <p className="mt-4 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">El QR y las etiquetas se habilitan en el bloque C.</p>
        </section>

        <section className="surface-card p-5 lg:col-span-2" aria-labelledby="attr-titulo">
          <h2 id="attr-titulo" className="mb-3 text-lg font-bold">
            Características
          </h2>
          {data.attrs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin características capturadas.</p>
          ) : (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {data.attrs.map((a) => (
                <Row key={a.attribute_id} label={a.attributes?.name ?? "Atributo"}>
                  {attrText(a)}
                </Row>
              ))}
            </dl>
          )}
        </section>

        <section className="surface-card p-5" aria-labelledby="var-titulo">
          <h2 id="var-titulo" className="mb-3 text-lg font-bold">
            Otras variantes del modelo
          </h2>
          {data.siblings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Es la única variante visible de este producto.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.siblings.map((s) => (
                <li key={s.id}>
                  <Link to="/inventario/$variantId" params={{ variantId: s.id }} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-muted">
                    <span className="font-mono text-xs font-semibold">{s.sku ?? "Borrador"}</span>
                    <span className="truncate">{s.variant_label ?? "—"}</span>
                    {s.record_status !== "registered" && <Badge variant="muted">{RECORD_LABEL[s.record_status]}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isAdmin && (
          <CostCard variantId={v.id} cost={data.cost} currency={currency} unitSingular={baseUnit?.name_singular ?? "unidad"} onSaved={invalidate} />
        )}

        <section className={isAdmin ? "surface-card p-5 lg:col-span-2" : "surface-card p-5 lg:col-span-3"} aria-labelledby="hist-titulo">
          <h2 id="hist-titulo" className="mb-3 text-lg font-bold">
            Historial
          </h2>
          {data.counts.length === 0 && data.adjustments.length === 0 && data.corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {[
                ...data.counts.map((c) => ({
                  at: c.counted_at,
                  key: `c-${c.id}`,
                  node: (
                    <>
                      <Badge variant={c.status === "confirmed" ? "success" : c.status === "in_review" ? "warning" : "muted"}>Conteo · {COUNT_STATUS[c.status]}</Badge>{" "}
                      {treePath(locations, c.location_id)}: <strong>{qty(Number(c.quantity))}</strong>
                      {c.full_presentations !== null && c.conversion_factor !== null && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({formatNumber(c.full_presentations)} {presUnit?.name_plural ?? "presentaciones"} × {formatNumber(c.conversion_factor)} + {formatNumber(c.loose_quantity ?? 0)} sueltos)
                        </span>
                      )}
                      {c.capture_ref && <span className="text-muted-foreground"> · Ref. {c.capture_ref}</span>}
                      <span className="text-muted-foreground"> · {nameOf(c.counted_by)}</span>
                    </>
                  ),
                })),
                ...data.adjustments.map((a) => ({
                  at: a.created_at,
                  key: `a-${a.id}`,
                  node: (
                    <>
                      <Badge variant="graphite">Ajuste</Badge> {treePath(locations, a.location_id)}: {qty(Number(a.previous_quantity))} → <strong>{qty(Number(a.new_quantity))}</strong> · {a.reason}
                      <span className="text-muted-foreground"> · {nameOf(a.created_by)}</span>
                    </>
                  ),
                })),
                ...data.corrections.map((c) => ({
                  at: c.created_at,
                  key: `r-${c.id}`,
                  node: (
                    <>
                      <Badge variant={c.status === "open" ? "warning" : "muted"}>Corrección · {c.status === "open" ? "abierta" : c.status === "resolved" ? "resuelta" : "rechazada"}</Badge> {c.message}
                      {c.resolution_note && <span className="text-muted-foreground"> · Respuesta: {c.resolution_note}</span>}
                      <span className="text-muted-foreground"> · {nameOf(c.requested_by)}</span>
                    </>
                  ),
                })),
              ]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map((e) => (
                  <li key={e.key} className="flex flex-col gap-0.5 border-b pb-2 last:border-none sm:flex-row sm:gap-3">
                    <span className="w-36 shrink-0 text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                    <span>{e.node}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      <CountDialog target={countTarget} onClose={() => setCountTarget(null)} />
      <CorrectionDialog open={correctionOpen} onOpenChange={setCorrectionOpen} variantId={v.id} userId={me?.id} onDone={invalidate} />
      <TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} variantId={v.id} />
      <AdjustDialog
        locationId={adjustLoc}
        onClose={() => setAdjustLoc(null)}
        variantId={v.id}
        current={data.levels.find((l) => l.location_id === adjustLoc)?.quantity ?? null}
        allowsDecimal={baseUnit?.allows_decimal ?? true}
        unitPlural={baseUnit?.name_plural ?? ""}
        locationName={treePath(locations, adjustLoc) ?? ""}
        onDone={invalidate}
      />
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>¿Archivar {v.sku}?</DialogTitle>
            <DialogDescription>
              Dejará de aparecer en el inventario y en las alertas. El código {v.sku} no se reutilizará nunca. Las existencias e historial se conservan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => archive.mutate()} disabled={archive.isPending}>
              {archive.isPending && <Loader2 className="animate-spin" />} Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function CorrectionDialog({
  open,
  onOpenChange,
  variantId,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  variantId: string;
  userId: string | undefined;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("correction_requests").insert({ variant_id: variantId, message: message.trim(), requested_by: userId! });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Solicitud enviada al Administrador");
      setMessage("");
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 3) return toast.error("Describe qué hay que corregir");
    m.mutate();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Solicitar corrección</DialogTitle>
            <DialogDescription>El registro ya fue confirmado. Explica qué está mal; el Administrador lo revisará.</DialogDescription>
          </DialogHeader>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={4} placeholder="Ej. El ancho correcto es 38 mm, no 25 mm." aria-label="Qué hay que corregir" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending && <Loader2 className="animate-spin" />} Enviar solicitud
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateDialog({ open, onOpenChange, variantId }: { open: boolean; onOpenChange: (o: boolean) => void; variantId: string }) {
  const [incl, setIncl] = useState<Record<string, boolean>>({ nombre: false, tipo: true, desc: true, attrs: true });
  const options = [
    { key: "nombre", label: "Nombre del producto" },
    { key: "tipo", label: "Tipo y categoría" },
    { key: "desc", label: "Descripción y usos" },
    { key: "attrs", label: "Características (diseño, material, medidas…)" },
  ];
  const incluir = Object.entries(incl)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(",");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Duplicar como plantilla</DialogTitle>
          <DialogDescription>Se crea un producto nuevo con los datos que elijas. Nunca se copian SKU, cantidades, costos ni el estado del conteo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!incl[o.key]} onCheckedChange={(c) => setIncl({ ...incl, [o.key]: c === true })} />
              {o.label}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button asChild>
            <Link to="/capturar" search={{ plantilla: variantId, incluir: incluir || "ninguno" }} onClick={() => onOpenChange(false)}>
              Usar como plantilla
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({
  locationId,
  onClose,
  variantId,
  current,
  allowsDecimal,
  unitPlural,
  locationName,
  onDone,
}: {
  locationId: string | null;
  onClose: () => void;
  variantId: string;
  current: number | null;
  allowsDecimal: boolean;
  unitPlural: string;
  locationName: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<AdjustmentMode>("set");
  const [raw, setRaw] = useState("");
  const [reason, setReason] = useState("");
  const parsed = parseMinimum(raw, allowsDecimal);
  const preview = parsed.ok ? computeAdjustment(current, mode, parsed.value) : null;
  const m = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) throw new Error(parsed.error);
      const { error } = await supabase.rpc("apply_stock_adjustment", {
        _variant_id: variantId,
        _location_id: locationId!,
        _mode: mode,
        _quantity: parsed.value,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajuste registrado");
      setRaw("");
      setReason("");
      onClose();
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <Dialog open={!!locationId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.ok) return toast.error(parsed.error);
            if (reason.trim().length < 3) return toast.error("Escribe el motivo del ajuste");
            if (preview && !preview.ok) return toast.error(preview.error);
            m.mutate();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Ajustar existencia</DialogTitle>
            <DialogDescription>
              {locationName}. Existencia actual: {current === null ? "pendiente" : `${formatNumber(current, 3)} ${unitPlural}`}. Queda en el historial con su motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={mode} onValueChange={(x) => setMode(x as AdjustmentMode)}>
                <SelectTrigger aria-label="Tipo de ajuste">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="set">Fijar total</SelectItem>
                  <SelectItem value="increase">Sumar</SelectItem>
                  <SelectItem value="decrease">Restar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-qty">Cantidad ({unitPlural})</Label>
              <Input id="adj-qty" inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Motivo</Label>
            <Input id="adj-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ej. Merma por corte" />
          </div>
          {preview && (
            <p className={preview.ok ? "text-sm" : "text-sm text-destructive"}>
              {preview.ok ? `Quedará en ${formatNumber(preview.value, 3)} ${unitPlural}` : preview.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending && <Loader2 className="animate-spin" />} Aplicar ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CostCard({
  variantId,
  cost,
  currency,
  unitSingular,
  onSaved,
}: {
  variantId: string;
  cost: { cost_per_base_unit: number; currency: string; updated_at: string } | null;
  currency: string;
  unitSingular: string;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const value = Number(raw.trim().replace(",", "."));
      if (!Number.isFinite(value) || value < 0) throw new Error("Escribe un costo válido");
      const { error } = await supabase.from("variant_costs").upsert({ variant_id: variantId, cost_per_base_unit: value, currency });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Costo guardado");
      setRaw("");
      onSaved();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <section className="surface-graphite p-5" aria-labelledby="cost-titulo">
      <h2 id="cost-titulo" className="text-lg font-bold">
        Costo (solo Administrador)
      </h2>
      <p className="mt-2 text-2xl font-bold tabular">
        {cost ? `${formatMoney(Number(cost.cost_per_base_unit), cost.currency)} por ${unitSingular}` : "Costo pendiente"}
      </p>
      {cost && <p className="text-xs opacity-70">Actualizado {formatDateTime(cost.updated_at)}</p>}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Input
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={`${currency} por ${unitSingular}`}
          aria-label="Nuevo costo"
          className="bg-card text-foreground"
        />
        <Button type="submit" disabled={m.isPending || raw.trim() === ""}>
          {m.isPending && <Loader2 className="animate-spin" />} Guardar
        </Button>
      </form>
    </section>
  );
}
