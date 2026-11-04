import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { effectiveState, type AttrDef, type AttrValue, type UnitLite } from "@/lib/capture";
import { cn } from "@/lib/utils";

const NONE = "__none";

export function AttributeInput({
  def,
  value,
  onChange,
  measureUnits,
  error,
  hideLabel,
  disabled,
}: {
  def: AttrDef;
  value: AttrValue;
  onChange: (next: AttrValue) => void;
  measureUnits: UnitLite[];
  error?: string | null;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const state = effectiveState(def, value);
  const locked = value.state === "not_applicable" || value.state === "pending";
  const set = (patch: Partial<AttrValue>) => onChange({ ...value, state: "value", ...patch });
  const toggleState = (s: "not_applicable" | "pending") =>
    onChange({ ...value, state: value.state === s ? "empty" : s });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={cn("text-sm font-medium", hideLabel && "sr-only")}>
        {def.name}
        {def.is_required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
        {def.is_required && <span className="sr-only"> (obligatorio)</span>}
      </label>

      {locked ? (
        <div
          id={id}
          className="flex h-10 items-center rounded-xl border border-dashed border-border bg-muted/50 px-3 text-sm text-muted-foreground"
        >
          {value.state === "pending" ? "Dato pendiente" : "No aplica"}
        </div>
      ) : def.data_type === "number" ? (
        <div className="flex gap-1.5">
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={value.number}
            disabled={disabled}
            onChange={(e) => set({ number: e.target.value })}
            aria-invalid={!!error}
            className="min-w-0 flex-1"
            placeholder="0"
          />
          <Select
            value={value.unitId ?? NONE}
            onValueChange={(v) => onChange({ ...value, unitId: v === NONE ? null : v })}
            disabled={disabled}
          >
            <SelectTrigger className="w-[88px] shrink-0" aria-label={`Unidad de ${def.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {measureUnits.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.symbol ?? u.name_plural}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : def.data_type === "select" ? (
        <Select value={value.text || NONE} onValueChange={(v) => set({ text: v === NONE ? "" : v })} disabled={disabled}>
          <SelectTrigger id={id} aria-invalid={!!error}>
            <SelectValue placeholder="Elige…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sin elegir</SelectItem>
            {def.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : def.data_type === "multiselect" ? (
        <div id={id} role="group" aria-label={def.name} className="flex flex-wrap gap-1.5">
          {def.options.map((o) => {
            const on = value.options.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => set({ options: on ? value.options.filter((x) => x !== o) : [...value.options, o] })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      ) : (
        <Input
          id={id}
          autoComplete="off"
          value={value.text}
          maxLength={300}
          disabled={disabled}
          onChange={(e) => set({ text: e.target.value })}
          aria-invalid={!!error}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(["pending", "not_applicable"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={value.state === s}
            onClick={() => toggleState(s)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              value.state === s
                ? "border-graphite bg-graphite text-graphite-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {s === "pending" ? "Dato pendiente" : "No aplica"}
          </button>
        ))}
        {state === "empty" && !error && !def.is_required && (
          <span className="text-[11px] text-muted-foreground">Vacío = pendiente</span>
        )}
      </div>
      {error && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
