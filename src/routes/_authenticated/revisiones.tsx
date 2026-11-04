import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { locationsQuery, staffQuery, treePath } from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useMe } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/revisiones")({
  head: () => ({
    meta: [
      { title: "Revisiones · Aly Inventario" },
      { name: "description", content: "Solicitudes de corrección y conteos en revisión." },
      { property: "og:title", content: "Revisiones · Aly Inventario" },
      { property: "og:description", content: "Solicitudes de corrección y conteos en revisión." },
    ],
  }),
  component: RevisionesPage,
});

const STATUS_LABEL = { open: "Abierta", resolved: "Resuelta", rejected: "Rechazada" } as const;

function RevisionesPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const qc = useQueryClient();
  const { data: staff = [] } = useQuery(staffQuery);
  const { data: locations = [] } = useQuery(locationsQuery);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name || "—";

  const corrections = useQuery({
    queryKey: ["reviews", "corrections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("correction_requests")
        .select("id, variant_id, requested_by, message, status, resolution_note, resolved_at, created_at, variants(sku, variant_label, products(name))")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useQuery({
    queryKey: ["reviews", "counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_counts")
        .select("id, variant_id, location_id, quantity, counted_by, counted_at, capture_ref, variants(sku, variant_label, products(name), units!variants_base_unit_id_fkey(name_singular, name_plural))")
        .eq("status", "in_review")
        .order("counted_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = data ?? [];
      const pairs = rows.map((r) => r.variant_id);
      const { data: levels } = pairs.length
        ? await supabase.from("stock_levels").select("variant_id, location_id, quantity").in("variant_id", pairs)
        : { data: [] };
      return rows.map((r) => ({
        ...r,
        current: (levels ?? []).find((l) => l.variant_id === r.variant_id && l.location_id === r.location_id)?.quantity ?? null,
      }));
    },
  });

  const [notes, setNotes] = useState<Record<string, string>>({});

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "resolved" | "rejected" }) => {
      const { error } = await supabase
        .from("correction_requests")
        .update({ status, resolution_note: notes[id]?.trim() || null, resolved_by: me!.id, resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Solicitud actualizada");
      qc.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const reviewCount = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc("review_count", { _id: id, _accept: accept, _note: notes[id]?.trim() || undefined });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.accept ? "Conteo aceptado: la existencia se reemplazó (no se sumó)" : "Conteo rechazado");
      qc.invalidateQueries({ queryKey: ["reviews"] });
      qc.invalidateQueries({ queryKey: ["catalog", "search"] });
      qc.invalidateQueries({ queryKey: ["variant"] });
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const openCorrections = (corrections.data ?? []).filter((c) => c.status === "open").length;

  return (
    <div>
      <PageHeader
        title="Revisiones"
        description={
          isAdmin
            ? "Atiende las solicitudes de corrección de los Editores y decide qué conteo repetido es el correcto. Nada se suma automáticamente."
            : "Tus solicitudes de corrección y los conteos que quedaron en revisión."
        }
      />
      <Tabs defaultValue="correcciones">
        <TabsList className="mb-4 rounded-full">
          <TabsTrigger value="correcciones" className="rounded-full">
            Correcciones {openCorrections > 0 && `(${openCorrections})`}
          </TabsTrigger>
          <TabsTrigger value="conteos" className="rounded-full">
            Conteos en revisión {(counts.data?.length ?? 0) > 0 && `(${counts.data?.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="correcciones">
          <div className="surface-card divide-y p-0">
            {corrections.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
            ) : (corrections.data ?? []).length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No hay solicitudes. Se crean desde la ficha de un SKU confirmado con «Solicitar corrección».
              </p>
            ) : (
              (corrections.data ?? []).map((c) => (
                <div key={c.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to="/inventario/$variantId" params={{ variantId: c.variant_id }} className="font-mono text-sm font-semibold underline-offset-2 hover:underline">
                        {c.variants?.sku ?? "SKU"}
                      </Link>
                      <span className="text-sm font-medium">
                        {c.variants?.products?.name}
                        {c.variants?.variant_label ? ` · ${c.variants.variant_label}` : ""}
                      </span>
                      <Badge variant={c.status === "open" ? "warning" : c.status === "resolved" ? "success" : "muted"}>{STATUS_LABEL[c.status]}</Badge>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {nameOf(c.requested_by)} · {formatDateTime(c.created_at)}
                    </p>
                    {c.resolution_note && <p className="mt-1 text-xs">Respuesta: {c.resolution_note}</p>}
                  </div>
                  {isAdmin && c.status === "open" && (
                    <div className="flex w-full flex-col gap-2 md:w-80">
                      <Input placeholder="Nota (opcional)" value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} maxLength={1000} aria-label="Nota de respuesta" />
                      <div className="flex gap-2">
                        <Button size="sm" asChild variant="outline">
                          <Link to="/capturar" search={{ editar: c.variant_id }}>Editar SKU</Link>
                        </Button>
                        <Button size="sm" onClick={() => resolve.mutate({ id: c.id, status: "resolved" })} disabled={resolve.isPending}>
                          <Check /> Resuelta
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: c.id, status: "rejected" })} disabled={resolve.isPending}>
                          <X /> Rechazar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="conteos">
          <div className="surface-card divide-y p-0">
            {counts.isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
            ) : (counts.data ?? []).length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No hay conteos en revisión. Un conteo queda aquí cuando alguien cuenta otra vez el mismo SKU en la misma ubicación.
              </p>
            ) : (
              (counts.data ?? []).map((c) => {
                const u = c.variants?.units;
                const unit = (n: number | null) => (n === 1 ? u?.name_singular : u?.name_plural) ?? "";
                return (
                  <div key={c.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to="/inventario/$variantId" params={{ variantId: c.variant_id }} className="font-mono text-sm font-semibold hover:underline">
                          {c.variants?.sku}
                        </Link>
                        <span className="text-sm font-medium">
                          {c.variants?.products?.name}
                          {c.variants?.variant_label ? ` · ${c.variants.variant_label}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">
                        {treePath(locations, c.location_id)}: existencia actual{" "}
                        <strong>{c.current === null ? "pendiente" : `${formatNumber(c.current, 3)} ${unit(c.current)}`}</strong> · nuevo conteo{" "}
                        <strong>
                          {formatNumber(c.quantity, 3)} {unit(c.quantity)}
                        </strong>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {nameOf(c.counted_by)} · {formatDateTime(c.counted_at)}
                        {c.capture_ref ? ` · Ref. ${c.capture_ref}` : ""}
                      </p>
                    </div>
                    {isAdmin ? (
                      <div className="flex w-full flex-col gap-2 md:w-96">
                        <Input placeholder="Motivo o nota (opcional)" value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} maxLength={300} aria-label="Nota" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => reviewCount.mutate({ id: c.id, accept: true })} disabled={reviewCount.isPending}>
                            {reviewCount.isPending && reviewCount.variables?.id === c.id && <Loader2 className="animate-spin" />}
                            <Check /> Usar este conteo
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => reviewCount.mutate({ id: c.id, accept: false })} disabled={reviewCount.isPending}>
                            <X /> Conservar el actual
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Badge variant="warning">Esperando al Administrador</Badge>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
