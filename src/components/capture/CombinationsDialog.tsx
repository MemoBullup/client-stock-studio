import { useEffect, useMemo, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { comboKey, combinationKeys, parseNumber, type AttrDef, type UnitLite } from "@/lib/capture";
import { cn } from "@/lib/utils";

const NONE = "__none";

export interface ComboPick {
  attrA: AttrDef;
  valueA: string;
  attrB: AttrDef | null;
  valueB: string | null;
  unitA: string | null;
  unitB: string | null;
}

function AxisValues({
  def,
  values,
  onChange,
  unitId,
  onUnit,
  measureUnits,
}: {
  def: AttrDef;
  values: string[];
  onChange: (v: string[]) => void;
  unitId: string | null;
  onUnit: (id: string | null) => void;
  measureUnits: UnitLite[];
}) {
  const [raw, setRaw] = useState(values.join(", "));
  useEffect(() => setRaw(values.join(", ")), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if ((def.data_type === "select" || def.data_type === "multiselect") && def.options.length > 0) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Valores de ${def.name}`}>
        {def.options.map((o) => {
          const on = values.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? values.filter((x) => x !== o) : [...values, o])}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted",
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <Input
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const parts = e.target.value
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(
            def.data_type === "number" ? parts.filter((p) => parseNumber(p) !== null) : parts,
          );
        }}
        placeholder={def.data_type === "number" ? "Ej. 10, 25, 38" : "Separados por coma"}
        aria-label={`Valores de ${def.name}`}
      />
      {def.data_type === "number" && (
        <Select value={unitId ?? NONE} onValueChange={(v) => onUnit(v === NONE ? null : v)}>
          <SelectTrigger className="w-24" aria-label="Unidad">
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
      )}
    </div>
  );
}

/** Tabla de colores × medidas: solo se agregan las combinaciones marcadas. */
export function CombinationsDialog({
  open,
  onOpenChange,
  defs,
  measureUnits,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defs: AttrDef[];
  measureUnits: UnitLite[];
  onAdd: (picks: ComboPick[]) => void;
}) {
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [aVals, setAVals] = useState<string[]>([]);
  const [bVals, setBVals] = useState<string[]>([]);
  const [aUnit, setAUnit] = useState<string | null>(null);
  const [bUnit, setBUnit] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const a = defs.find((d) => d.data_type === "select") ?? defs[0];
    const b =
      defs.find((d) => d.id !== a?.id && d.data_type === "number") ??
      defs.find((d) => d.id !== a?.id) ??
      null;
    setAId(a?.id ?? null);
    setBId(b?.id ?? null);
    setAVals([]);
    setBVals([]);
    setAUnit(a?.default_unit_id ?? null);
    setBUnit(b?.default_unit_id ?? null);
    setChecked(new Set());
  }, [open, defs]);

  const attrA = defs.find((d) => d.id === aId) ?? null;
  const attrB = defs.find((d) => d.id === bId) ?? null;
  const combos = useMemo(
    () => (attrA ? combinationKeys(aVals, attrB ? bVals : []) : []),
    [attrA, attrB, aVals, bVals],
  );
  const selected = combos.filter(([a, b]) => checked.has(comboKey(a, b)));
  const unitLabel = (id: string | null) => {
    const u = measureUnits.find((x) => x.id === id);
    return u ? ` ${u.symbol ?? u.name_plural}` : "";
  };

  function toggle(a: string, b: string | null) {
    const k = comboKey(a, b);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear variantes en tabla</DialogTitle>
          <DialogDescription>
            Elige los valores y marca solo las combinaciones que realmente existen. Las demás no se
            crean.
          </DialogDescription>
        </DialogHeader>
        {defs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este tipo de producto no tiene atributos que distingan variantes.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Primer atributo</Label>
                <Select
                  value={aId ?? NONE}
                  onValueChange={(v) => {
                    setAId(v);
                    setAVals([]);
                    setChecked(new Set());
                    setAUnit(defs.find((d) => d.id === v)?.default_unit_id ?? null);
                  }}
                >
                  <SelectTrigger aria-label="Primer atributo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {defs.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {attrA && (
                  <AxisValues
                    def={attrA}
                    values={aVals}
                    onChange={setAVals}
                    unitId={aUnit}
                    onUnit={setAUnit}
                    measureUnits={measureUnits}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Segundo atributo (opcional)</Label>
                <Select
                  value={bId ?? NONE}
                  onValueChange={(v) => {
                    setBId(v === NONE ? null : v);
                    setBVals([]);
                    setChecked(new Set());
                    setBUnit(defs.find((d) => d.id === v)?.default_unit_id ?? null);
                  }}
                >
                  <SelectTrigger aria-label="Segundo atributo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Ninguno</SelectItem>
                    {defs
                      .filter((d) => d.id !== aId)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {attrB && (
                  <AxisValues
                    def={attrB}
                    values={bVals}
                    onChange={setBVals}
                    unitId={bUnit}
                    onUnit={setBUnit}
                    measureUnits={measureUnits}
                  />
                )}
              </div>
            </div>

            {combos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Vista previa · marca las que existen</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setChecked(new Set(combos.map(([a, b]) => comboKey(a, b))))}
                  >
                    Marcar todas
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-2xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">{attrA?.name}</th>
                        {(attrB && bVals.length > 0 ? bVals : [null]).map((b) => (
                          <th key={b ?? "-"} className="px-3 py-2 text-center font-semibold">
                            {b === null ? "Incluir" : `${b}${unitLabel(bUnit)}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {aVals.map((a) => (
                        <tr key={a} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {a}
                            {unitLabel(aUnit)}
                          </td>
                          {(attrB && bVals.length > 0 ? bVals : [null]).map((b) => (
                            <td key={b ?? "-"} className="px-3 py-2 text-center">
                              <Checkbox
                                checked={checked.has(comboKey(a, b))}
                                onCheckedChange={() => toggle(a, b)}
                                aria-label={`${a}${b ? ` · ${b}` : ""}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={selected.length === 0 || !attrA}
            onClick={() => {
              onAdd(
                selected.map(([a, b]) => ({
                  attrA: attrA!,
                  valueA: a,
                  attrB: b === null ? null : attrB,
                  valueB: b,
                  unitA: aUnit,
                  unitB: bUnit,
                })),
              );
              onOpenChange(false);
            }}
          >
            Agregar {selected.length} {selected.length === 1 ? "variante" : "variantes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
