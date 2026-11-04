import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  categoriesQuery,
  locationsQuery,
  openSessionQuery,
  productTypesQuery,
  treePath,
  unitsQuery,
} from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { downloadXlsx, fileStamp, readSpreadsheet } from "@/lib/files";
import { formatNumber, normalizeText } from "@/lib/format";
import {
  FIXED_COLUMNS,
  MAX_IMPORT_ROWS,
  parseImport,
  stableUuid,
  templateHeaders,
  type ImportGroup,
  type ParsedImport,
} from "@/lib/importer";

type Mode = "registered" | "draft";
interface Outcome {
  key: string;
  name: string;
  ok: boolean;
  message?: string;
  variants: Array<{ id: string; sku: string | null; label: string | null; inReview: boolean }>;
}

/** Alta masiva desde Excel/CSV: plantilla por tipo, revisión fila por fila y guardado por producto. */
export function ImportPanel() {
  const qc = useQueryClient();
  const { data: types = [] } = useQuery(productTypesQuery);
  const { data: units = [] } = useQuery(unitsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: locations = [] } = useQuery(locationsQuery);
  const { data: session } = useQuery(openSessionQuery);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("registered");
  const [file, setFile] = useState<File | null>(null);
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [existingNames, setExistingNames] = useState<Map<string, string>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);

  const type = types.find((t) => t.id === typeId);

  const parsed: ParsedImport | null = useMemo(() => {
    if (!matrix || !type) return null;
    return parseImport(matrix, {
      typeId: type.id,
      defaultUnitId: type.default_unit_id,
      defs: type.attributes,
      units,
      categories,
      locations,
      confirming: mode === "registered",
    });
  }, [matrix, type, units, categories, locations, mode]);

  const groupOk = (g: ImportGroup) =>
    g.errors.length === 0 && g.variants.every((v) => v.errors.length === 0);
  const ready = parsed?.groups.filter(groupOk) ?? [];
  const blocked = parsed?.groups.filter((g) => !groupOk(g)) ?? [];
  const readyRows = ready.reduce((n, g) => n + g.variants.length, 0);
  const needsSession =
    mode === "registered" && ready.some((g) => g.variants.some((v) => "location_id" in v.count));
  const sessionMissing = needsSession && !session;

  async function downloadTemplate() {
    if (!type) return;
    const headers = templateHeaders(type.attributes, units);
    const listRows: Array<[string, string]> = [
      ...categories
        .filter((c) => c.is_active !== false)
        .map((c) => ["Categoría", treePath(categories, c.id) ?? c.name] as [string, string]),
      ...locations
        .filter((l) => l.is_active !== false)
        .map((l) => ["Ubicación", treePath(locations, l.id) ?? l.name] as [string, string]),
      ...units
        .filter((u) => u.kind === "inventory")
        .map((u) => ["Unidad", `${u.name_singular} (${u.symbol ?? u.code})`] as [string, string]),
      ...type.attributes
        .filter((d) => d.options.length > 0)
        .flatMap((d) => d.options.map((o) => [d.name, o] as [string, string])),
    ];
    try {
      await downloadXlsx(
        [
          {
            name: "Productos",
            headers,
            rows: [],
            widths: headers.map((h) => Math.max(14, h.length + 4)),
          },
          {
            name: "Instrucciones",
            headers: ["Columna", "Cómo llenarla"],
            widths: [30, 100],
            rows: [
              ...FIXED_COLUMNS.map((c) => [c.header, c.help]),
              ...type.attributes
                .filter((d) => d.code !== "presentacion" && d.code !== "contenido_presentacion")
                .map((d) => [
                  d.name,
                  `${d.is_required ? "Obligatorio al confirmar. " : ""}${d.is_variant_defining ? "Distingue la variante. " : ""}${
                    d.data_type === "number"
                      ? "Número; puedes escribir la unidad (25 mm)."
                      : d.options.length
                        ? `Valores válidos en la hoja «Listas»${d.data_type === "multiselect" ? " (varios separados por coma)" : ""}.`
                        : "Texto libre."
                  } Escribe «pendiente» o «no aplica» cuando corresponda.`,
                ]),
              ["", ""],
              [
                "Importante",
                "Escribe los datos a partir de la fila 2 de la hoja «Productos». No cambies los encabezados.",
              ],
              [
                "Importante",
                "El SKU lo genera el sistema: no lo escribas. Si el archivo se sube dos veces, no se duplica.",
              ],
            ],
          },
          { name: "Listas", headers: ["Lista", "Valor válido"], widths: [24, 60], rows: listRows },
        ],
        `plantilla-${normalizeText(type.name).replace(/\s+/g, "-")}-${fileStamp()}.xlsx`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function onFile(f: File) {
    setReading(true);
    setOutcomes(null);
    try {
      const m = await readSpreadsheet(f);
      if (m.length < 2)
        throw new Error("El archivo no tiene filas de datos debajo de los encabezados.");
      if (m.length - 1 > MAX_IMPORT_ROWS)
        throw new Error(`El máximo por archivo es ${MAX_IMPORT_ROWS} filas.`);
      setFile(f);
      setMatrix(m);
      const col = m[0]!.findIndex((h) => /^producto/i.test(normalizeText(h)));
      const names = Array.from(
        new Set(
          m
            .slice(1)
            .map((r) => (r[col] ?? "").trim())
            .filter(Boolean),
        ),
      );
      const found = new Map<string, string>();
      for (let i = 0; i < names.length; i += 100) {
        const { data, error } = await supabase
          .from("products")
          .select("id, name")
          .in("name", names.slice(i, i + 100));
        if (error) throw error;
        for (const p of data ?? []) found.set(normalizeText(p.name), p.id);
      }
      setExistingNames(found);
    } catch (e) {
      setFile(null);
      setMatrix(null);
      toast.error(friendlyError(e));
    } finally {
      setReading(false);
    }
  }

  function reset() {
    setFile(null);
    setMatrix(null);
    setOutcomes(null);
  }

  async function runImport() {
    if (!type || !file || ready.length === 0 || sessionMissing) return;
    setRunning({ done: 0, total: ready.length });
    const results: Outcome[] = [];
    for (const g of ready) {
      try {
        const existingId = existingNames.get(g.key);
        const variantsPayload = await Promise.all(
          g.variants.map(async (v, idx) => {
            const { line: _line, errors: _errors, signature: _sig, count, ...rest } = v;
            const seed = JSON.stringify([type.id, mode, g.key, idx, rest, count]);
            return {
              ...rest,
              idempotency_key: await stableUuid(`v:${seed}`),
              count:
                mode === "draft"
                  ? "location_id" in count
                    ? {
                        pending: false,
                        location_id: count.location_id,
                        quantity_raw: String(count.quantity),
                      }
                    : { pending: true }
                  : "location_id" in count
                    ? {
                        location_id: count.location_id,
                        quantity: count.quantity,
                        capture_ref: `Archivo ${file.name}, fila ${v.line}`.slice(0, 80),
                      }
                    : { pending: true },
            };
          }),
        );
        const payload = {
          idempotency_key: await stableUuid(
            `p:${JSON.stringify([type.id, mode, g.product, variantsPayload.map((v) => v.idempotency_key)])}`,
          ),
          status: mode,
          product: existingId ? { ...g.product, id: existingId, update: false } : g.product,
          variants: variantsPayload,
        };
        const { data, error } = await supabase.rpc("save_capture", {
          _payload: payload as unknown as Json,
        });
        if (error) throw error;
        const res = data as unknown as {
          variants: Array<{
            id: string;
            sku: string | null;
            variant_label: string | null;
            count: { status: string } | null;
          }>;
        };
        results.push({
          key: g.key,
          name: g.product.name,
          ok: true,
          variants: res.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            label: v.variant_label,
            inReview: v.count?.status === "in_review",
          })),
        });
      } catch (e) {
        results.push({
          key: g.key,
          name: g.product.name,
          ok: false,
          message: friendlyError(e),
          variants: [],
        });
      }
      setRunning({ done: results.length, total: ready.length });
    }
    setRunning(null);
    setOutcomes(results);
    qc.invalidateQueries({ queryKey: ["catalog", "search"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["stock-alerts"] });
    const ok = results.filter((r) => r.ok);
    const failed = results.length - ok.length;
    const saved = ok.reduce((n, r) => n + r.variants.length, 0);
    if (failed) toast.warning(`Se guardaron ${saved} SKU; ${failed} producto(s) no se guardaron.`);
    else toast.success(`Se guardaron ${saved} SKU desde el archivo.`);
  }

  return (
    <div className="space-y-6">
      <section className="surface-card p-5 sm:p-6" aria-labelledby="imp-1">
        <h2 id="imp-1" className="text-lg font-bold">
          1. Elige el tipo de producto y descarga la plantilla
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada archivo es de un solo tipo, porque las columnas cambian según sus características.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="imp-type">Tipo de producto</Label>
            <Select value={typeId ?? ""} onValueChange={(v) => setTypeId(v)} disabled={!!running}>
              <SelectTrigger id="imp-type" className="w-64">
                <SelectValue placeholder="Elige un tipo" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={downloadTemplate} disabled={!type}>
            <Download /> Descargar plantilla de Excel
          </Button>
        </div>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">¿Cómo se guardan?</legend>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="mt-2 grid gap-2 sm:grid-cols-2"
            disabled={!!running}
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent">
              <RadioGroupItem value="registered" className="mt-0.5" />
              <span className="text-sm">
                <strong>Confirmar y generar SKU.</strong> Se exigen las características
                obligatorias; las cantidades se registran en la sesión de levantamiento abierta.
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent">
              <RadioGroupItem value="draft" className="mt-0.5" />
              <span className="text-sm">
                <strong>Guardar como borradores.</strong> Sin SKU; se completan y confirman después
                desde Inventario.
              </span>
            </label>
          </RadioGroup>
        </fieldset>
      </section>

      <section className="surface-card p-5 sm:p-6" aria-labelledby="imp-2">
        <h2 id="imp-2" className="text-lg font-bold">
          2. Sube el archivo lleno
        </h2>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        {!file ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!type || reading}
            className="mt-4 flex w-full flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-input bg-muted/40 px-6 py-10 text-center transition hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {reading ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : (
              <FileUp className="size-8 text-primary" />
            )}
            <span className="font-semibold">
              {type ? "Elegir archivo Excel (.xlsx) o CSV" : "Primero elige el tipo de producto"}
            </span>
            <span className="text-xs text-muted-foreground">
              Hasta {formatNumber(MAX_IMPORT_ROWS, 0)} filas por archivo. Nada se guarda hasta que
              lo confirmes.
            </span>
          </button>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3">
            <FileSpreadsheet className="size-5 text-success" aria-hidden />
            <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatNumber(parsed?.rowCount ?? 0, 0)} filas
            </span>
            <Button size="sm" variant="ghost" onClick={reset} disabled={!!running}>
              <X /> Quitar
            </Button>
          </div>
        )}
      </section>

      {parsed && !outcomes && (
        <section className="surface-card p-5 sm:p-6" aria-labelledby="imp-3">
          <h2 id="imp-3" className="text-lg font-bold">
            3. Revisa antes de guardar
          </h2>
          {parsed.fileErrors.length > 0 ? (
            <ul
              className="mt-3 space-y-1 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive"
              role="alert"
            >
              {parsed.fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <SummaryTile
                  label="Listos para guardar"
                  value={`${ready.length} productos · ${readyRows} SKU`}
                  tone="ok"
                />
                <SummaryTile
                  label="Con errores (no se guardan)"
                  value={`${blocked.length} productos`}
                  tone={blocked.length ? "bad" : "muted"}
                />
                <SummaryTile
                  label="Con cantidad contada"
                  value={`${ready.reduce((n, g) => n + g.variants.filter((v) => "location_id" in v.count).length, 0)} SKU`}
                  tone="muted"
                />
              </div>
              {parsed.unknownColumns.length > 0 && (
                <p className="mt-3 flex gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning-foreground">
                  <TriangleAlert className="size-4 shrink-0" /> Columnas que no se reconocen y se
                  ignorarán: {parsed.unknownColumns.join(", ")}
                </p>
              )}
              {sessionMissing && (
                <p
                  className="mt-3 flex gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning-foreground"
                  role="alert"
                >
                  <TriangleAlert className="size-4 shrink-0" /> No hay una sesión de levantamiento
                  abierta. Pide a un Administrador que la abra, o guarda como borradores.
                </p>
              )}
              <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Variante</th>
                      <th className="px-3 py-2">Cantidad</th>
                      <th className="px-3 py-2">Revisión</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsed.groups.flatMap((g) =>
                      g.variants.map((v, i) => {
                        const errs = [...(i === 0 ? g.errors : []), ...v.errors];
                        const unit = units.find((u) => u.id === v.base_unit_id);
                        return (
                          <tr
                            key={`${g.key}-${v.line}`}
                            className={errs.length ? "bg-destructive/5" : undefined}
                          >
                            <td className="px-3 py-2 tabular text-muted-foreground">{v.line}</td>
                            <td className="px-3 py-2 font-medium">
                              {g.product.name || "—"}
                              {i === 0 && existingNames.has(g.key) && (
                                <Badge variant="info" className="ml-2">
                                  Ya existe: se agrega como variante
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">{v.variant_label ?? "—"}</td>
                            <td className="px-3 py-2 tabular">
                              {"location_id" in v.count ? (
                                <>
                                  {formatNumber(v.count.quantity, 3)}{" "}
                                  {unit?.symbol ?? unit?.name_plural ?? ""}
                                  <span className="block text-xs text-muted-foreground">
                                    {treePath(locations, v.count.location_id)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-muted-foreground">Pendiente</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {errs.length ? (
                                <ul className="space-y-0.5 text-xs text-destructive">
                                  {errs.map((e) => (
                                    <li key={e}>{e}</li>
                                  ))}
                                </ul>
                              ) : (
                                <Badge variant="success">Correcta</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                {blocked.length > 0 && (
                  <p className="mr-auto text-sm text-muted-foreground">
                    Corrige las filas marcadas en tu archivo y vuelve a subirlo; lo ya guardado no
                    se duplica.
                  </p>
                )}
                {running && (
                  <span className="text-sm text-muted-foreground tabular" role="status">
                    Guardando {running.done} de {running.total}…
                  </span>
                )}
                <Button
                  onClick={() => void runImport()}
                  disabled={!!running || ready.length === 0 || sessionMissing}
                >
                  {running ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  {mode === "registered"
                    ? `Guardar ${readyRows} SKU`
                    : `Guardar ${readyRows} borradores`}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {outcomes && (
        <section className="surface-card p-5 sm:p-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Resultado de la importación</h2>
            <Button variant="outline" size="sm" onClick={reset}>
              <FileUp /> Subir otro archivo
            </Button>
          </div>
          <ul className="mt-4 divide-y rounded-2xl border">
            {outcomes.map((o) => (
              <li key={o.key} className="flex flex-wrap items-start gap-3 p-3 text-sm">
                {o.ok ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : (
                  <TriangleAlert className="size-5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{o.name}</p>
                  {o.ok ? (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {o.variants.map((v) => (
                        <Link
                          key={v.id}
                          to="/inventario/$variantId"
                          params={{ variantId: v.id }}
                          className="font-mono text-xs underline underline-offset-2"
                        >
                          {v.sku ?? "Borrador"}
                          {v.label ? ` · ${v.label}` : ""}
                          {v.inReview ? " (conteo en revisión)" : ""}
                        </Link>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-destructive">{o.message}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {blocked.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {blocked.length} producto(s) con errores no se enviaron. Corrígelos en el archivo y
              súbelo de nuevo.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "bad" | "muted";
}) {
  return (
    <div
      className={
        tone === "ok"
          ? "rounded-2xl bg-success-soft p-4"
          : tone === "bad"
            ? "rounded-2xl bg-destructive/10 p-4"
            : "rounded-2xl bg-muted p-4"
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}
