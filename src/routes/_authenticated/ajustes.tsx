import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, Send, Sparkles, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { proposeAdjustment } from "@/lib/adjustments.functions";
import type { CandidateDTO, ProposeResult } from "@/lib/adjustments.types";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { useMe } from "@/lib/session";
import { computeAdjustment, parseMinimum, type AdjustmentMode } from "@/lib/stock";
import { buildTree, flattenTree, pathOf, type TreeItem } from "@/lib/tree";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ajustes")({
  head: () => ({
    meta: [
      { title: "Ajustes asistidos · Aly Inventario" },
      {
        name: "description",
        content:
          "Describe un ajuste de inventario y recibe una propuesta de SKU, ubicación y cantidad.",
      },
      { property: "og:title", content: "Ajustes asistidos · Aly Inventario" },
      {
        property: "og:description",
        content:
          "Describe un ajuste de inventario y recibe una propuesta de SKU, ubicación y cantidad.",
      },
    ],
  }),
  component: AjustesPage,
});

const MODE_LABEL: Record<AdjustmentMode, string> = {
  set: "Fijar total",
  increase: "Sumar",
  decrease: "Restar",
};

const EXAMPLES = [
  "En la Caja 02 encontré 3 metros más del listón arcoíris de 25 mm",
  "Se dañaron 4 Santa Claus de 8 cm del exhibidor",
  "En el mostrador solo quedan 2 dijes de audífonos lila",
];

function useLocations() {
  return useQuery({
    queryKey: ["locations-lite"],
    queryFn: async (): Promise<TreeItem[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, parent_id, name, sort_order, depth, is_active");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

type Proposal = Extract<ProposeResult, { ok: true }>;

function AjustesPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const propose = useServerFn(proposeAdjustment);
  const locations = useLocations();
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [result, setResult] = useState<Proposal | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (t: string) => propose({ data: { text: t } }),
    onSuccess: (res) => {
      if (res.ok) {
        setResult(res);
        setAiError(null);
      } else {
        setResult(null);
        setAiError(res.error);
      }
    },
    onError: (e) => setAiError(friendlyError(e)),
  });

  function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (t.length < 5) return setTextError("Describe el ajuste con un poco más de detalle.");
    if (t.length > 1000) return setTextError("Máximo 1000 caracteres.");
    setTextError(null);
    ask.mutate(t);
  }

  return (
    <>
      <PageHeader
        title="Ajustes asistidos"
        description={
          isAdmin
            ? "Describe el ajuste con tus palabras. La IA propone el SKU, la ubicación y la cantidad; tú revisas y lo aplicas."
            : "Describe el ajuste con tus palabras. La IA propone el SKU, la ubicación y la cantidad; tú revisas y lo envías al Administrador para su aprobación."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <form
          onSubmit={onSubmit}
          className="surface-card grid content-start gap-4 p-5 sm:p-6"
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="adj-text">¿Qué pasó con el inventario?</Label>
            <Textarea
              id="adj-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit();
              }}
              placeholder="Ej. En la Caja 02 encontré 3 metros más del listón arcoíris de 25 mm"
              maxLength={1000}
              aria-invalid={!!textError}
              aria-describedby="adj-help"
              className="rounded-2xl"
            />
            <p id="adj-help" className="text-xs text-muted-foreground">
              Menciona el producto (nombre, color o medida), la ubicación y la cantidad. Ctrl +
              Enter para enviar.
            </p>
            {textError && <p className="text-sm text-destructive">{textError}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setText(ex)}
                className="rounded-full border bg-muted px-3 py-1.5 text-left text-xs hover:bg-accent"
              >
                {ex}
              </button>
            ))}
          </div>
          <Button type="submit" size="lg" disabled={ask.isPending} className="justify-self-start">
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {ask.isPending ? "Analizando…" : "Proponer ajuste"}
          </Button>
          {aiError && (
            <p
              role="alert"
              className="rounded-2xl bg-warning-soft p-4 text-sm text-warning-foreground"
            >
              {aiError}
            </p>
          )}
        </form>

        {result ? (
          <ProposalEditor
            key={JSON.stringify(result.proposal)}
            result={result}
            sourceText={text.trim()}
            locations={locations.data ?? []}
            isAdmin={isAdmin}
            onDone={() => {
              setResult(null);
              setText("");
            }}
          />
        ) : (
          <div className="surface-graphite flex flex-col justify-center gap-3 p-8">
            <Sparkles className="size-6 text-primary" aria-hidden />
            <h2 className="text-xl font-bold">La propuesta aparecerá aquí</h2>
            <p className="text-sm text-graphite-muted">
              La IA solo elige entre SKU confirmados y ubicaciones existentes. Nada se modifica
              hasta que una persona revisa y confirma.
            </p>
          </div>
        )}
      </div>

      <RequestsList isAdmin={isAdmin} locations={locations.data ?? []} />
    </>
  );
}

function ProposalEditor({
  result,
  sourceText,
  locations,
  isAdmin,
  onDone,
}: {
  result: Proposal;
  sourceText: string;
  locations: TreeItem[];
  isAdmin: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const p = result.proposal;
  const [variantId, setVariantId] = useState(p.variantId ?? "");
  const [locationId, setLocationId] = useState(p.locationId ?? "");
  const [mode, setMode] = useState<AdjustmentMode>(p.mode ?? "set");
  const [qtyRaw, setQtyRaw] = useState(p.quantity !== null ? String(p.quantity) : "");
  const [reason, setReason] = useState(p.reason);
  const [error, setError] = useState<string | null>(null);

  const variant: CandidateDTO | undefined = result.candidates.find((c) => c.id === variantId);
  const unit = variant
    ? {
        name_singular: variant.unitSingular,
        name_plural: variant.unitPlural,
        allows_decimal: variant.allowsDecimal,
      }
    : null;
  const current =
    result.stock.find((s) => s.variantId === variantId && s.locationId === locationId)?.quantity ??
    null;
  const parsedQty = parseMinimum(qtyRaw, variant?.allowsDecimal ?? true);
  const preview =
    variant && locationId && parsedQty.ok
      ? computeAdjustment(current, mode, parsedQty.value)
      : null;

  const locationOptions = useMemo(
    () =>
      flattenTree(buildTree(locations))
        .filter((l) => l.is_active)
        .map((l) => ({ value: l.id, label: pathOf(locations, l.id) })),
    [locations],
  );
  const stockLocations = result.stock.filter((s) => s.variantId === variantId);

  const submit = useMutation({
    mutationFn: async () => {
      if (!variant) throw new Error("Elige el SKU");
      if (!locationId) throw new Error("Elige la ubicación");
      if (!parsedQty.ok) throw new Error(parsedQty.error);
      if (reason.trim().length < 3) throw new Error("Escribe el motivo del ajuste");
      if (preview && !preview.ok) throw new Error(preview.error);
      if (isAdmin) {
        const { error } = await supabase.rpc("apply_stock_adjustment", {
          _variant_id: variant.id,
          _location_id: locationId,
          _mode: mode,
          _quantity: parsedQty.value,
          _reason: reason.trim(),
        });
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("stock_adjustment_requests").insert({
          variant_id: variant.id,
          location_id: locationId,
          mode,
          quantity: parsedQty.value,
          reason: reason.trim(),
          source_text: sourceText.slice(0, 1000),
          ai_proposal: p as never,
          requested_by: u.user!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        isAdmin
          ? "Ajuste aplicado y registrado en el historial"
          : "Solicitud enviada al Administrador",
      );
      qc.invalidateQueries({ queryKey: ["adjustment-requests"] });
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
      onDone();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  return (
    <section
      className="surface-card grid content-start gap-4 p-5 sm:p-6"
      aria-labelledby="prop-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="prop-title" className="text-lg font-bold">
          Propuesta
        </h2>
        <Badge
          variant={
            p.confidence === "alta" ? "success" : p.confidence === "media" ? "info" : "warning"
          }
        >
          Confianza {p.confidence}
        </Badge>
      </div>
      {p.explanation && (
        <p className="rounded-2xl bg-sky p-4 text-sm text-sky-foreground">{p.explanation}</p>
      )}
      {p.missingInfo.length > 0 && (
        <ul className="list-disc rounded-2xl bg-warning-soft py-3 pl-8 pr-4 text-sm text-warning-foreground">
          {p.missingInfo.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-2">
        <Label htmlFor="prop-sku">SKU</Label>
        <Select value={variantId} onValueChange={setVariantId}>
          <SelectTrigger id="prop-sku" className="h-auto min-h-10 rounded-2xl text-left">
            <SelectValue placeholder="Elige el SKU" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {result.candidates.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.sku} · {c.productName}
                {c.variantLabel ? ` · ${c.variantLabel}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {variant?.attributes && (
          <p className="text-xs text-muted-foreground">{variant.attributes}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="prop-loc">Ubicación</Label>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger id="prop-loc" className="rounded-2xl">
            <SelectValue placeholder="Elige la ubicación" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {locationOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {variant && unit && stockLocations.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Existencias de este SKU:{" "}
            {stockLocations
              .map((s) => `${pathOf(locations, s.locationId)}: ${formatQuantity(s.quantity, unit)}`)
              .join(" · ")}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium" id="prop-mode">
          Tipo de ajuste
        </span>
        <div
          className="inline-flex w-fit rounded-full bg-graphite p-1"
          role="radiogroup"
          aria-labelledby="prop-mode"
        >
          {(Object.keys(MODE_LABEL) as AdjustmentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-graphite-foreground hover:bg-graphite-soft",
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="prop-qty">Cantidad</Label>
        <div className="flex items-center gap-2">
          <Input
            id="prop-qty"
            inputMode="decimal"
            value={qtyRaw}
            onChange={(e) => setQtyRaw(e.target.value)}
            className="w-36 tabular"
            aria-invalid={qtyRaw !== "" && !parsedQty.ok}
          />
          <span className="text-sm text-muted-foreground">{variant ? variant.unitPlural : ""}</span>
        </div>
        {qtyRaw !== "" && !parsedQty.ok && (
          <p className="text-sm text-destructive">{parsedQty.error}</p>
        )}
      </div>

      {variant && unit && locationId && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-2xl p-4 text-sm",
            preview && !preview.ok ? "bg-warning-soft text-warning-foreground" : "bg-muted",
          )}
          aria-live="polite"
        >
          {current === null ? (
            <span>
              Este SKU está pendiente de conteo en esa ubicación; no se puede ajustar hasta
              registrar su conteo inicial.
            </span>
          ) : preview?.ok ? (
            <>
              <span>
                Actual: <strong>{formatQuantity(current, unit)}</strong>
              </span>
              <ArrowRight className="size-4" aria-hidden />
              <span>
                Quedará: <strong>{formatQuantity(preview.value, unit)}</strong>
              </span>
            </>
          ) : preview ? (
            <span>{preview.error}</span>
          ) : (
            <span>
              Actual: <strong>{formatQuantity(current, unit)}</strong>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="prop-reason">Motivo (queda en el historial)</Label>
        <Input
          id="prop-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => submit.mutate()}
          disabled={submit.isPending || current === null || !!(preview && !preview.ok)}
        >
          {submit.isPending ? <Loader2 className="animate-spin" /> : isAdmin ? <Check /> : <Send />}
          {isAdmin ? "Aplicar ajuste" : "Enviar al Administrador"}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Descartar
        </Button>
      </div>
    </section>
  );
}

interface RequestRow {
  id: string;
  variant_id: string;
  location_id: string;
  mode: AdjustmentMode;
  quantity: number;
  reason: string;
  source_text: string | null;
  status: "open" | "resolved" | "rejected";
  requested_by: string;
  created_at: string;
  review_note: string | null;
  variants: {
    sku: string | null;
    variant_label: string | null;
    products: { name: string } | null;
    base_unit: { name_singular: string; name_plural: string; allows_decimal: boolean } | null;
  } | null;
}

function RequestsList({ isAdmin, locations }: { isAdmin: boolean; locations: TreeItem[] }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"open" | "all">("open");

  const requests = useQuery({
    queryKey: ["adjustment-requests", filter],
    queryFn: async () => {
      let q = supabase
        .from("stock_adjustment_requests")
        .select(
          "id, variant_id, location_id, mode, quantity, reason, source_text, status, requested_by, created_at, review_note, variants(sku, variant_label, products(name), base_unit:units!variants_base_unit_id_fkey(name_singular, name_plural, allows_decimal))",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (filter === "open") q = q.eq("status", "open");
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as RequestRow[];
      const people = [...new Set(rows.map((r) => r.requested_by))];
      const variantIds = [...new Set(rows.map((r) => r.variant_id))];
      const [profiles, stock] = await Promise.all([
        people.length
          ? supabase.from("profiles").select("id, full_name").in("id", people)
          : Promise.resolve({ data: [] }),
        variantIds.length
          ? supabase
              .from("stock_levels")
              .select("variant_id, location_id, quantity")
              .in("variant_id", variantIds)
          : Promise.resolve({ data: [] }),
      ]);
      const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name]));
      const levels = new Map(
        (stock.data ?? []).map((s) => [`${s.variant_id}:${s.location_id}`, Number(s.quantity)]),
      );
      return rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        requesterName: names.get(r.requested_by) || "Usuario",
        current: levels.get(`${r.variant_id}:${r.location_id}`) ?? null,
      }));
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc("review_adjustment_request", {
        _id: id,
        _approve: approve,
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.approve ? "Ajuste aplicado" : "Solicitud rechazada");
      qc.invalidateQueries({ queryKey: ["adjustment-requests"] });
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <section className="surface-card mt-4 p-5 sm:p-6" aria-labelledby="req-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="req-title" className="text-lg font-bold">
          {isAdmin ? "Solicitudes de ajuste del equipo" : "Mis solicitudes de ajuste"}
        </h2>
        <div className="inline-flex rounded-full bg-muted p-1" role="tablist">
          {(
            [
              ["open", "Pendientes"],
              ["all", "Todas"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold",
                filter === k ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {requests.isLoading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </p>
        ) : requests.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {friendlyError(requests.error)}
          </p>
        ) : (requests.data?.length ?? 0) === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {filter === "open" ? "No hay solicitudes pendientes." : "Todavía no hay solicitudes."}
          </p>
        ) : (
          requests.data!.map((r) => {
            const unit = r.variants?.base_unit ?? {
              name_singular: "unidad",
              name_plural: "unidades",
              allows_decimal: true,
            };
            const after = computeAdjustment(r.current, r.mode, r.quantity);
            return (
              <article
                key={r.id}
                className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-graphite px-2.5 py-0.5 font-mono text-xs text-graphite-foreground">
                      {r.variants?.sku}
                    </span>
                    <span className="font-semibold">{r.variants?.products?.name}</span>
                    {r.variants?.variant_label && (
                      <span className="text-sm text-muted-foreground">
                        · {r.variants.variant_label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm">
                    <strong>{MODE_LABEL[r.mode]}</strong> {formatQuantity(r.quantity, unit)} en{" "}
                    {pathOf(locations, r.location_id)}
                    {r.status === "open" && after.ok && r.current !== null && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatQuantity(r.current, unit)} → {formatQuantity(after.value, unit)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.reason} · {r.requesterName} · {formatDateTime(r.created_at)}
                  </p>
                  {r.source_text && (
                    <p className="mt-1 text-xs italic text-muted-foreground">«{r.source_text}»</p>
                  )}
                  {r.review_note && <p className="mt-1 text-xs">Nota: {r.review_note}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === "open" ? (
                    isAdmin ? (
                      <>
                        <Button
                          size="sm"
                          disabled={review.isPending || !after.ok}
                          onClick={() => review.mutate({ id: r.id, approve: true })}
                          title={after.ok ? undefined : after.error}
                        >
                          <Check /> Aprobar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: r.id, approve: false })}
                        >
                          <X /> Rechazar
                        </Button>
                      </>
                    ) : (
                      <Badge variant="info">Pendiente de revisión</Badge>
                    )
                  ) : r.status === "resolved" ? (
                    <Badge variant="success">Aplicado</Badge>
                  ) : (
                    <Badge variant="muted">Rechazado</Badge>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
