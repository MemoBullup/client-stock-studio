import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { TreeSelect } from "@/components/capture/TreeSelect";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { computeCount, emptyCount, newKey } from "@/lib/capture";
import { locationsQuery } from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";

export interface CountTarget {
  variantId: string;
  sku: string | null;
  name: string;
  unitSingular: string;
  unitPlural: string;
  allowsDecimal: boolean;
  /** Contenido conocido por presentación (p. ej. metros por rollo). */
  factor: number | null;
  presentationPlural?: string | null;
  /** Ubicaciones donde ya tiene existencias. */
  countedLocationIds?: string[];
}

/** Registrar el conteo de un SKU existente en una ubicación (sin crear otro SKU). */
export function CountDialog({
  target,
  onClose,
}: {
  target: CountTarget | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: locations = [] } = useQuery(locationsQuery);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [count, setCount] = useState(emptyCount());
  const [ref, setRef] = useState("");
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setLocationId(null);
      setCount(emptyCount());
      setRef("");
      setKey(newKey());
      setError(null);
    }
  }, [target]);

  const result = useMemo(
    () =>
      target
        ? computeCount({ ...count, pending: false }, target.factor, target.allowsDecimal)
        : null,
    [count, target],
  );
  const already = !!locationId && !!target?.countedLocationIds?.includes(locationId);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target || !locationId || !result || !result.ok || result.pending)
        throw new Error("Revisa los datos");
      const { data, error } = await supabase.rpc("record_count", {
        _payload: {
          variant_id: target.variantId,
          location_id: locationId,
          quantity: result.quantity,
          full_presentations: result.full,
          loose_quantity: result.loose,
          capture_ref: ref,
          idempotency_key: key,
        },
      });
      if (error) throw error;
      return data as { status: "confirmed" | "in_review"; quantity: number };
    },
    onSuccess: (data) => {
      if (data.status === "in_review")
        toast.warning(
          "Ya había un conteo en esa ubicación. Este quedó en revisión para el Administrador; no se sumó.",
        );
      else toast.success("Conteo guardado");
      qc.invalidateQueries({ queryKey: ["catalog", "search"] });
      qc.invalidateQueries({ queryKey: ["variant"] });
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
      qc.invalidateQueries({ queryKey: ["reviews"] });
      onClose();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!locationId) return setError("Elige la ubicación");
    if (!result?.ok) return setError(result && !result.ok ? result.error : "Revisa la cantidad");
    mutation.mutate();
  }

  const useFactor = !!target?.factor;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar conteo</DialogTitle>
            <DialogDescription>
              {target?.sku ?? "Sin SKU"} · {target?.name}. Se registra en la ubicación elegida sin
              crear otro SKU.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="count-loc">Ubicación</Label>
            <TreeSelect
              id="count-loc"
              items={locations}
              value={locationId}
              onChange={setLocationId}
              placeholder="Elige la ubicación"
            />
            {already && (
              <p className="text-xs text-warning-foreground">
                Este SKU ya tiene existencia en esa ubicación: el conteo quedará en revisión y no se
                sumará.
              </p>
            )}
          </div>
          {useFactor ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="count-full">
                  {target?.presentationPlural ?? "Presentaciones"} completas
                </Label>
                <Input
                  id="count-full"
                  inputMode="numeric"
                  value={count.full}
                  onChange={(e) => setCount({ ...count, full: e.target.value, quantity: "" })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="count-loose">{target?.unitPlural} sueltos</Label>
                <Input
                  id="count-loose"
                  inputMode="decimal"
                  value={count.loose}
                  onChange={(e) => setCount({ ...count, loose: e.target.value, quantity: "" })}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                1 {target?.presentationPlural ?? "presentación"} = {formatNumber(target?.factor)}{" "}
                {target?.unitPlural}. O escribe el total:
              </p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="count-qty">Cantidad total ({target?.unitPlural})</Label>
            <Input
              id="count-qty"
              inputMode="decimal"
              value={count.quantity}
              onChange={(e) => setCount({ ...emptyCount(), quantity: e.target.value })}
              placeholder="0 si se contó y no hay"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="count-ref">Referencia de captura (opcional)</Label>
            <Input
              id="count-ref"
              value={ref}
              maxLength={80}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Ej. Hoja 3, renglón 12"
            />
          </div>
          {result?.ok && !result.pending && (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm">
              Total:{" "}
              <strong>
                {formatNumber(result.total, 3)}{" "}
                {result.total === 1 ? target?.unitSingular : target?.unitPlural}
              </strong>
            </p>
          )}
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />} Guardar conteo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
