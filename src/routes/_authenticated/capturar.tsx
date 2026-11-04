import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Grid3x3,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { AttributeInput } from "@/components/capture/AttributeInput";
import { CategoryPicker } from "@/components/capture/CategoryPicker";
import { CombinationsDialog, type ComboPick } from "@/components/capture/CombinationsDialog";
import { CountDialog, type CountTarget } from "@/components/capture/CountDialog";
import { TreeSelect } from "@/components/capture/TreeSelect";
import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  attrToPayload,
  buildVariantLabel,
  computeCount,
  duplicateIndexes,
  emptyAttr,
  emptyCount,
  newKey,
  parseNumber,
  parseTags,
  validateAttr,
  type AttrDef,
  type AttrValue,
  type CountInput,
} from "@/lib/capture";
import {
  categoriesQuery,
  locationsQuery,
  openSessionQuery,
  productTypesQuery,
  RECORD_LABEL,
  treePath,
  unitsQuery,
  type ProductTypeFull,
} from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatNumber } from "@/lib/format";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

interface CaptureSearch {
  editar?: string | undefined;
  producto?: string | undefined;
  plantilla?: string | undefined;
  incluir?: string | undefined;
}

export const Route = createFileRoute("/_authenticated/capturar")({
  validateSearch: (s: Record<string, unknown>): CaptureSearch => ({
    editar: typeof s["editar"] === "string" ? s["editar"] : undefined,
    producto: typeof s["producto"] === "string" ? s["producto"] : undefined,
    plantilla: typeof s["plantilla"] === "string" ? s["plantilla"] : undefined,
    incluir: typeof s["incluir"] === "string" ? s["incluir"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Capturar SKU · Aly Inventario" },
      { name: "description", content: "Captura rápida de productos, variantes y conteo inicial." },
      { property: "og:title", content: "Capturar SKU · Aly Inventario" },
      {
        property: "og:description",
        content: "Captura rápida de productos, variantes y conteo inicial.",
      },
    ],
  }),
  component: CapturarPage,
});

const NONE = "__none";
const UNIT_ATTR_CODES = new Set(["presentacion", "contenido_presentacion"]);
const RECENT_KEY = "aly-capture-recents";

interface Row {
  key: string;
  id?: string | undefined;
  label: string;
  labelTouched: boolean;
  supplierCode: string;
  attrs: Record<string, AttrValue>;
  count: CountInput;
}

interface ExistingProduct {
  id: string;
  name: string;
  typeId: string | null;
  categoryId: string | null;
}

interface ProductFields {
  name: string;
  typeId: string | null;
  categoryId: string | null;
  description: string;
  tags: string;
  notes: string;
}

interface SavedVariant {
  id: string;
  sku: string | null;
  record_status: "draft" | "registered" | "archived";
  variant_label: string | null;
  reused: boolean;
  count: { status: "confirmed" | "in_review"; quantity: number } | null;
}
interface SaveResult {
  product_id: string;
  product_name: string;
  variants: SavedVariant[];
}

interface Recents {
  categories: string[];
  locations: string[];
}

function readRecents(): Recents {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}");
    return { categories: parsed.categories ?? [], locations: parsed.locations ?? [] };
  } catch {
    return { categories: [], locations: [] };
  }
}

function pushRecent(list: string[], id: string | null) {
  if (!id) return list;
  return [id, ...list.filter((x) => x !== id)].slice(0, 5);
}

function emptyProduct(): ProductFields {
  return { name: "", typeId: null, categoryId: null, description: "", tags: "", notes: "" };
}

function newRow(defs: AttrDef[]): Row {
  const attrs: Record<string, AttrValue> = {};
  for (const d of defs) attrs[d.id] = emptyAttr(d);
  return {
    key: newKey(),
    label: "",
    labelTouched: false,
    supplierCode: "",
    attrs,
    count: emptyCount(),
  };
}

type DbAttr = {
  attribute_id: string;
  value_state: "value" | "not_applicable" | "pending";
  value_text: string | null;
  value_number: number | null;
  value_options: string[] | null;
  unit_id: string | null;
};

function fromDb(a: DbAttr): AttrValue {
  return {
    state: a.value_state,
    text: a.value_text ?? "",
    number: a.value_number !== null ? String(a.value_number) : "",
    options: a.value_options ?? [],
    unitId: a.unit_id,
  };
}

async function loadSource(variantId: string) {
  const { data: v, error } = await supabase
    .from("variants")
    .select(
      "id, sku, product_id, variant_label, supplier_code, legacy_code, base_unit_id, presentation_unit_id, units_per_presentation, notes, record_status, created_by, draft_count",
    )
    .eq("id", variantId)
    .maybeSingle();
  if (error) throw error;
  if (!v) throw new Error("No encontramos ese registro o no tienes acceso.");
  const [p, attrs] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, product_type_id, category_id, description, usage_tags, notes, created_by")
      .eq("id", v.product_id)
      .single(),
    supabase
      .from("variant_attribute_values")
      .select("attribute_id, value_state, value_text, value_number, value_options, unit_id")
      .eq("variant_id", variantId),
  ]);
  if (p.error) throw p.error;
  if (attrs.error) throw attrs.error;
  return { variant: v, product: p.data, attrs: (attrs.data ?? []) as DbAttr[] };
}

function CapturarPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";

  const { data: types = [], isLoading: typesLoading } = useQuery(productTypesQuery);
  const { data: units = [] } = useQuery(unitsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: locations = [] } = useQuery(locationsQuery);
  const { data: session, isLoading: sessionLoading } = useQuery(openSessionQuery);

  const inventoryUnits = units.filter((u) => u.kind === "inventory");
  const measureUnits = units.filter((u) => u.kind === "measure");

  // ---------- Estado del formulario ----------
  const [saveKey, setSaveKey] = useState(newKey);
  const [existing, setExisting] = useState<ExistingProduct | null>(null);
  const [updateProduct, setUpdateProduct] = useState(false);
  const [product, setProduct] = useState<ProductFields>(emptyProduct);
  const [shared, setShared] = useState<Record<string, AttrValue>>({});
  const [baseUnitId, setBaseUnitId] = useState<string | null>(null);
  const [presentationUnitId, setPresentationUnitId] = useState<string | null>(null);
  const [factor, setFactor] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [captureRef, setCaptureRef] = useState("");
  const [legacyCode, setLegacyCode] = useState("");
  const [variantNotes, setVariantNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [keep, setKeep] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [combosOpen, setCombosOpen] = useState(false);
  const [summary, setSummary] = useState<{
    dupExisting: Map<number, { id: string; sku: string | null; label: string | null }>;
    dupBatch: Set<number>;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastSaved, setLastSaved] = useState<SaveResult | null>(null);
  const [recents, setRecents] = useState<Recents>({ categories: [], locations: [] });
  const [editing, setEditing] = useState<{
    id: string;
    status: "draft" | "registered";
    sku: string | null;
  } | null>(null);
  const [countTarget, setCountTarget] = useState<CountTarget | null>(null);
  const appliedSource = useRef<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => setRecents(readRecents()), []);

  const typeId = existing ? existing.typeId : product.typeId;
  const type: ProductTypeFull | undefined = types.find((t) => t.id === typeId);
  // La presentación y su contenido se capturan en la sección de unidades (con conversión validada),
  // así que no se piden dos veces como atributos.
  const defs = (type?.attributes ?? []).filter((d) => !UNIT_ATTR_CODES.has(d.code));
  const sharedDefs = defs.filter((d) => !d.is_variant_defining);
  const rowDefs = defs.filter((d) => d.is_variant_defining);
  const baseUnit = units.find((u) => u.id === baseUnitId);
  const presentationUnit = units.find((u) => u.id === presentationUnitId);
  const factorNum = parseNumber(factor);
  const editingRegistered = editing?.status === "registered";

  // Al cambiar de tipo se preparan los campos relevantes.
  function applyType(t: ProductTypeFull | undefined, keepValues = false) {
    const nextShared: Record<string, AttrValue> = {};
    for (const d of t?.attributes.filter((a) => !a.is_variant_defining) ?? [])
      nextShared[d.id] = (keepValues ? shared[d.id] : undefined) ?? emptyAttr(d);
    setShared(nextShared);
    setRows([newRow(t?.attributes.filter((a) => a.is_variant_defining) ?? [])]);
    setBaseUnitId(t?.default_unit_id ?? (keepValues ? baseUnitId : null) ?? inventoryUnits[0]?.id ?? null);
  }

  // ---------- Carga inicial: editar, nueva variante o plantilla ----------
  const sourceId = search.editar ?? search.plantilla ?? null;
  const sourceQuery = useQuery({
    queryKey: ["capture-source", sourceId],
    enabled: !!sourceId,
    queryFn: () => loadSource(sourceId!),
    staleTime: 0,
    gcTime: 0,
  });
  const productSourceQuery = useQuery({
    queryKey: ["capture-product", search.producto],
    enabled: !!search.producto && !sourceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, product_type_id, category_id")
        .eq("id", search.producto!)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No encontramos ese producto.");
      // Toma las características comunes de una variante existente como punto de partida.
      const { data: sibling } = await supabase
        .from("variants")
        .select("id")
        .eq("product_id", data.id)
        .neq("record_status", "archived")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const src = sibling ? await loadSource(sibling.id) : null;
      return { product: data, src };
    },
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (typesLoading || types.length === 0 || units.length === 0) return;
    const marker = JSON.stringify(search);
    if (appliedSource.current === marker) return;

    if (sourceId) {
      if (!sourceQuery.data) return;
      appliedSource.current = marker;
      const { variant, product: p, attrs } = sourceQuery.data;
      const t = types.find((x) => x.id === p.product_type_id);
      const tDefs = t?.attributes ?? [];
      const byId = new Map(attrs.map((a) => [a.attribute_id, fromDb(a)]));
      const nextShared: Record<string, AttrValue> = {};
      for (const d of tDefs.filter((a) => !a.is_variant_defining))
        nextShared[d.id] = byId.get(d.id) ?? emptyAttr(d);
      const rowAttrs: Record<string, AttrValue> = {};
      for (const d of tDefs.filter((a) => a.is_variant_defining))
        rowAttrs[d.id] = byId.get(d.id) ?? emptyAttr(d);
      setBaseUnitId(variant.base_unit_id);
      setPresentationUnitId(variant.presentation_unit_id);
      setFactor(
        variant.units_per_presentation !== null ? String(variant.units_per_presentation) : "",
      );
      setLastSaved(null);
      setErrors({});
      setFormError(null);
      setSaveKey(newKey());

      if (search.editar) {
        const dc = (variant.draft_count ?? null) as Record<string, unknown> | null;
        setEditing({
          id: variant.id,
          status: variant.record_status === "registered" ? "registered" : "draft",
          sku: variant.sku,
        });
        setExisting({
          id: p.id,
          name: p.name,
          typeId: p.product_type_id,
          categoryId: p.category_id,
        });
        const canUpdateProduct =
          isAdmin || (p.created_by === me?.id && variant.record_status === "draft");
        setUpdateProduct(canUpdateProduct);
        setProduct({
          name: p.name,
          typeId: p.product_type_id,
          categoryId: p.category_id,
          description: p.description ?? "",
          tags: (p.usage_tags ?? []).join(", "),
          notes: p.notes ?? "",
        });
        setShared(nextShared);
        setLegacyCode(variant.legacy_code ?? "");
        setVariantNotes(variant.notes ?? "");
        if (dc && typeof dc["location_id"] === "string") setLocationId(dc["location_id"]);
        setRows([
          {
            key: newKey(),
            id: variant.id,
            label: variant.variant_label ?? "",
            labelTouched: !!variant.variant_label,
            supplierCode: variant.supplier_code ?? "",
            attrs: rowAttrs,
            count: {
              pending: !!dc?.["pending"],
              quantity: typeof dc?.["quantity_raw"] === "string" ? dc["quantity_raw"] : "",
              full: typeof dc?.["full_raw"] === "string" ? dc["full_raw"] : "",
              loose: typeof dc?.["loose_raw"] === "string" ? dc["loose_raw"] : "",
            },
          },
        ]);
      } else {
        // Plantilla: solo los datos descriptivos elegidos. Sin SKU, cantidades, costos ni conteo.
        const incluir = new Set((search.incluir ?? "tipo,desc,attrs").split(","));
        setEditing(null);
        setExisting(null);
        setUpdateProduct(false);
        setProduct({
          name: incluir.has("nombre") ? p.name : "",
          typeId: p.product_type_id,
          categoryId: incluir.has("tipo") ? p.category_id : null,
          description: incluir.has("desc") ? (p.description ?? "") : "",
          tags: incluir.has("desc") ? (p.usage_tags ?? []).join(", ") : "",
          notes: "",
        });
        if (incluir.has("attrs")) {
          setShared(nextShared);
          setRows([{ ...newRow([]), attrs: rowAttrs }]);
        } else {
          applyType(t);
          setBaseUnitId(variant.base_unit_id);
        }
        toast.info("Plantilla cargada. Revisa los datos antes de guardar.");
      }
      return;
    }

    if (search.producto) {
      if (!productSourceQuery.data) return;
      appliedSource.current = marker;
      const { product: p, src } = productSourceQuery.data;
      setEditing(null);
      setUpdateProduct(false);
      setExisting({ id: p.id, name: p.name, typeId: p.product_type_id, categoryId: p.category_id });
      const t = types.find((x) => x.id === p.product_type_id);
      startNewVariantOf(t, src);
      return;
    }

    appliedSource.current = marker;
    setEditing(null);
    if (rows.length === 0) applyType(types.find((t) => t.id === product.typeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, types, units, typesLoading, sourceQuery.data, productSourceQuery.data]);

  function startNewVariantOf(
    t: ProductTypeFull | undefined,
    src: Awaited<ReturnType<typeof loadSource>> | null,
  ) {
    const tDefs = t?.attributes ?? [];
    const byId = new Map((src?.attrs ?? []).map((a) => [a.attribute_id, fromDb(a)]));
    const nextShared: Record<string, AttrValue> = {};
    for (const d of tDefs.filter((a) => !a.is_variant_defining))
      nextShared[d.id] = byId.get(d.id) ?? emptyAttr(d);
    setShared(nextShared);
    setRows([newRow(tDefs.filter((a) => a.is_variant_defining))]);
    setBaseUnitId(src?.variant.base_unit_id ?? t?.default_unit_id ?? null);
    setPresentationUnitId(src?.variant.presentation_unit_id ?? null);
    setFactor(
      src?.variant.units_per_presentation != null ? String(src.variant.units_per_presentation) : "",
    );
    setErrors({});
    setFormError(null);
    setSaveKey(newKey());
  }

  // ---------- Búsqueda previa ----------
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const matches = useQuery({
    queryKey: ["catalog", "search", "capture", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_catalog", { _q: debounced, _limit: 8 });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function chooseExistingFrom(variantId: string) {
    try {
      const src = await loadSource(variantId);
      const p = src.product;
      setEditing(null);
      setUpdateProduct(false);
      setExisting({ id: p.id, name: p.name, typeId: p.product_type_id, categoryId: p.category_id });
      startNewVariantOf(
        types.find((t) => t.id === p.product_type_id),
        src,
      );
      setLastSaved(null);
      setQ("");
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      toast.info(`Nueva variante de «${p.name}». Completa lo que la distingue.`);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function openCount(variantId: string) {
    const { data: v } = await supabase
      .from("variants")
      .select(
        "id, sku, variant_label, units_per_presentation, presentation_unit_id, base_unit_id, products(name)",
      )
      .eq("id", variantId)
      .maybeSingle();
    if (!v) {
      toast.error("No encontramos el SKU.");
      return;
    }
    if (!v.sku) {
      toast.error("Este registro aún es borrador: confírmalo antes de contarlo.");
      return;
    }
    const { data: levels } = await supabase
      .from("stock_levels")
      .select("location_id")
      .eq("variant_id", variantId);
    const bu = units.find((u) => u.id === v.base_unit_id);
    const pu = units.find((u) => u.id === v.presentation_unit_id);
    setCountTarget({
      variantId: v.id,
      sku: v.sku,
      name: `${v.products?.name ?? ""}${v.variant_label ? ` · ${v.variant_label}` : ""}`,
      unitSingular: bu?.name_singular ?? "",
      unitPlural: bu?.name_plural ?? "",
      allowsDecimal: bu?.allows_decimal ?? true,
      factor: v.units_per_presentation,
      presentationPlural: pu?.name_plural ?? null,
      countedLocationIds: (levels ?? []).map((l) => l.location_id),
    });
  }

  // ---------- Filas ----------
  function updateRow(key: string, patch: Partial<Row> | ((r: Row) => Partial<Row>)) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r,
      ),
    );
  }

  function rowLabel(r: Row) {
    return r.labelTouched ? r.label : buildVariantLabel(rowDefs, r.attrs, units);
  }

  function addCombos(picks: ComboPick[]) {
    setRows((prev) => {
      const template = prev[0];
      const keepFirst =
        prev.length > 1 ||
        (template && Object.values(template.attrs).some((a) => a.state !== "empty"));
      const created = picks.map((p) => {
        const r = newRow(rowDefs);
        if (template)
          for (const d of rowDefs) r.attrs[d.id] = { ...(template.attrs[d.id] ?? emptyAttr(d)) };
        const setVal = (def: AttrDef, value: string, unit: string | null) => {
          r.attrs[def.id] =
            def.data_type === "number"
              ? { ...emptyAttr(def), state: "value", number: value, unitId: unit }
              : def.data_type === "multiselect"
                ? { ...emptyAttr(def), state: "value", options: [value] }
                : { ...emptyAttr(def), state: "value", text: value };
        };
        setVal(p.attrA, p.valueA, p.unitA);
        if (p.attrB && p.valueB !== null) setVal(p.attrB, p.valueB, p.unitB);
        return r;
      });
      return keepFirst ? [...prev, ...created] : created;
    });
  }

  // ---------- Validación y armado del envío ----------
  function validate(confirming: boolean): boolean {
    const e: Record<string, string> = {};
    if (!existing || updateProduct) {
      if (!product.name.trim()) e["product.name"] = "Escribe el nombre del producto";
      if (product.name.trim().length > 160) e["product.name"] = "Máximo 160 caracteres";
      if (!product.typeId) e["product.type"] = "Elige el tipo de producto";
    }
    if (!baseUnitId) e["unit"] = "Elige la unidad base";
    if (factor.trim() !== "" && (factorNum === null || factorNum <= 0))
      e["factor"] = "Debe ser un número mayor que cero";
    for (const d of sharedDefs) {
      const err = validateAttr(d, shared[d.id], confirming);
      if (err) e[`shared.${d.id}`] = err;
    }
    const needsLocation = confirming && !editingRegistered && rows.some((r) => !r.count.pending);
    if (needsLocation && !locationId) e["location"] = "Elige la ubicación donde contaste";
    for (const r of rows) {
      for (const d of rowDefs) {
        const err = validateAttr(d, r.attrs[d.id], confirming);
        if (err) e[`row.${r.key}.${d.id}`] = err;
      }
      if (confirming && !editingRegistered) {
        const c = computeCount(r.count, factorNum, baseUnit?.allows_decimal ?? true);
        if (!c.ok) e[`row.${r.key}.count`] = c.error;
      }
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setFormError("Revisa los campos marcados.");
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>("[aria-invalid='true'], [role='alert']");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return false;
    }
    setFormError(null);
    return true;
  }

  function rowAttributes(r: Row) {
    return [
      ...sharedDefs.map((d) => attrToPayload(d, shared[d.id])),
      ...rowDefs.map((d) => attrToPayload(d, r.attrs[d.id])),
    ].filter(Boolean);
  }

  function buildPayload(status: "draft" | "registered") {
    const tags = parseTags(product.tags);
    const productPayload = existing
      ? {
          id: existing.id,
          update: updateProduct,
          name: product.name,
          product_type_id: product.typeId,
          category_id: product.categoryId,
          description: product.description,
          usage_tags: tags,
          notes: product.notes,
        }
      : {
          name: product.name,
          product_type_id: product.typeId,
          category_id: product.categoryId,
          description: product.description,
          usage_tags: tags,
          notes: product.notes,
        };
    return {
      idempotency_key: saveKey,
      status,
      product: productPayload,
      variants: rows.map((r) => {
        let count: Record<string, unknown> | undefined;
        if (!editingRegistered) {
          if (status === "draft") {
            count = {
              pending: r.count.pending,
              location_id: locationId,
              quantity_raw: r.count.quantity,
              full_raw: r.count.full,
              loose_raw: r.count.loose,
            };
          } else {
            const c = computeCount(r.count, factorNum, baseUnit?.allows_decimal ?? true);
            count =
              c.ok && !c.pending
                ? {
                    location_id: locationId,
                    quantity: c.quantity,
                    full_presentations: c.full,
                    loose_quantity: c.loose,
                    capture_ref: captureRef,
                  }
                : { pending: true };
          }
        }
        return {
          id: r.id,
          idempotency_key: r.key,
          variant_label: rowLabel(r) || null,
          supplier_code: r.supplierCode,
          legacy_code: legacyCode,
          notes: variantNotes,
          base_unit_id: baseUnitId,
          presentation_unit_id: presentationUnitId,
          units_per_presentation: factorNum,
          attributes: rowAttributes(r),
          count,
        };
      }),
    };
  }

  const save = useMutation({
    mutationFn: async (status: "draft" | "registered") => {
      const { data, error } = await supabase.rpc("save_capture", {
        _payload: buildPayload(status) as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as SaveResult;
    },
    onSuccess: (result, status) => {
      setSummary(null);
      qc.invalidateQueries({ queryKey: ["catalog", "search"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["variant"] });
      qc.invalidateQueries({ queryKey: ["stock-alerts"] });
      const nextRecents = {
        categories: pushRecent(
          recents.categories,
          product.categoryId ?? existing?.categoryId ?? null,
        ),
        locations: pushRecent(recents.locations, locationId),
      };
      setRecents(nextRecents);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecents));
      } catch {
        /* sin almacenamiento local: no pasa nada */
      }
      const inReview = result.variants.filter((v) => v.count?.status === "in_review").length;
      toast.success(
        status === "draft"
          ? "Borrador guardado"
          : `Guardado: ${result.variants
              .map((v) => v.sku)
              .filter(Boolean)
              .join(", ")}`,
      );
      if (inReview > 0)
        toast.warning(
          `${inReview} conteo(s) quedaron en revisión porque ya existía un conteo en esa ubicación.`,
        );

      if (editing) {
        navigate({ to: "/inventario/$variantId", params: { variantId: editing.id } });
        return;
      }
      setLastSaved(result);
      resetAfterSave();
    },
    onError: (e) => {
      setSummary(null);
      setFormError(friendlyError(e));
      toast.error("No se guardó. Lo capturado sigue aquí para reintentar.");
    },
  });

  function resetAfterSave() {
    setSaveKey(newKey());
    setErrors({});
    setFormError(null);
    setCaptureRef("");
    setLegacyCode("");
    setVariantNotes("");
    if (keep) {
      const t = types.find((x) => x.id === (existing?.typeId ?? product.typeId));
      setExisting(null);
      setProduct({
        ...emptyProduct(),
        typeId: t?.id ?? null,
        categoryId: product.categoryId ?? existing?.categoryId ?? null,
      });
      applyType(t, false);
      setPresentationUnitId(null);
      setFactor("");
    } else {
      setExisting(null);
      setProduct(emptyProduct());
      setShared({});
      setRows([]);
      setLocationId(null);
      setPresentationUnitId(null);
      setFactor("");
      setBaseUnitId(null);
    }
    if (search.producto || search.plantilla)
      navigate({ to: "/capturar", search: {}, replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function newVariantOfSaved() {
    if (!lastSaved) return;
    const t = types.find((x) => x.id === product.typeId);
    setExisting({
      id: lastSaved.product_id,
      name: lastSaved.product_name,
      typeId: product.typeId,
      categoryId: product.categoryId,
    });
    const firstId = lastSaved.variants[0]?.id;
    setLastSaved(null);
    if (firstId) void chooseExistingFrom(firstId);
    else startNewVariantOf(t, null);
  }

  async function openSummary() {
    if (!validate(true)) return;
    if (!typeId) return;
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc("check_variant_duplicates", {
        _product_id: (existing?.id ?? null) as unknown as string,
        _product_type_id: typeId,
        _rows: rows.map((r) => ({
          id: r.id ?? null,
          attributes: rowAttributes(r),
        })) as unknown as Json,
      });
      if (error) throw error;
      const dupExisting = new Map<
        number,
        { id: string; sku: string | null; label: string | null }
      >();
      const sigs: Array<string | null> = rows.map(() => null);
      for (const d of data ?? []) {
        sigs[d.idx] = d.signature;
        if (d.existing_id)
          dupExisting.set(d.idx, {
            id: d.existing_id,
            sku: d.existing_sku,
            label: d.existing_label,
          });
      }
      setSummary({ dupExisting, dupBatch: duplicateIndexes(sigs) });
    } catch (e) {
      setFormError(friendlyError(e));
    } finally {
      setChecking(false);
    }
  }

  function saveDraft() {
    if (!validate(false)) return;
    save.mutate("draft");
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!save.isPending && !checking) void openSummary();
    }
  }

  const busy = save.isPending || checking;
  const noSession = !sessionLoading && !session;
  const categoryForDisplay = existing && !updateProduct ? existing.categoryId : product.categoryId;
  const showProductForm = !existing || updateProduct;
  const loadingSource =
    (!!sourceId && sourceQuery.isLoading) || (!!search.producto && productSourceQuery.isLoading);
  const sourceError = sourceQuery.error ?? productSourceQuery.error;

  if (sourceError) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">No pudimos abrir ese registro</h1>
        <p className="mt-2 text-sm text-muted-foreground">{friendlyError(sourceError)}</p>
        <Button asChild className="mt-6">
          <Link to="/capturar" search={{}}>
            Capturar uno nuevo
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-28" onKeyDown={onKeyDown}>
      <PageHeader
        title={
          editing ? (editing.sku ? `Editar ${editing.sku}` : "Continuar borrador") : "Capturar SKU"
        }
        description={
          editing
            ? editingRegistered
              ? "Estás modificando un registro confirmado. El SKU no cambia; las existencias se corrigen desde la ficha."
              : "Completa el borrador y confírmalo para generar su SKU."
            : "Busca primero si ya existe. Si no, regístralo con su cantidad y ubicación. El SKU se genera al confirmar."
        }
        actions={
          editing ? (
            <Button variant="outline" asChild>
              <Link to="/inventario/$variantId" params={{ variantId: editing.id }}>
                <X /> Cancelar edición
              </Link>
            </Button>
          ) : undefined
        }
      />

      {noSession && !editingRegistered && (
        <div
          className="mb-4 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-foreground"
          role="status"
        >
          No hay una sesión de levantamiento abierta: puedes guardar borradores, pero los conteos
          necesitan una sesión.
        </div>
      )}

      {lastSaved && (
        <section className="surface-card mb-6 border-2 border-success/40 p-5" aria-live="polite">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-6 text-success" aria-hidden />
              <div>
                <h2 className="font-bold">Guardado · {lastSaved.product_name}</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {lastSaved.variants.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/inventario/$variantId"
                        params={{ variantId: v.id }}
                        className="font-mono font-semibold underline underline-offset-2"
                      >
                        {v.sku ?? "Borrador"}
                      </Link>
                      <span className="text-muted-foreground">{v.variant_label ?? ""}</span>
                      <Badge variant={v.record_status === "draft" ? "muted" : "success"}>
                        {RECORD_LABEL[v.record_status]}
                      </Badge>
                      {v.count?.status === "in_review" && (
                        <Badge variant="warning">Conteo en revisión</Badge>
                      )}
                      {v.record_status === "registered" && !v.count && (
                        <Badge variant="info">Pendiente de conteo</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={newVariantOfSaved}>
                <Plus /> Crear variante del mismo modelo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLastSaved(null)}
                aria-label="Cerrar aviso"
              >
                <X />
              </Button>
            </div>
          </div>
        </section>
      )}

      {!editing && (
        <section className="surface-card mb-6 p-5" aria-labelledby="buscar-titulo">
          <h2 id="buscar-titulo" className="mb-3 text-lg font-bold">
            1. Buscar si ya existe
          </h2>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="SKU, nombre, color, medida o código de proveedor"
              className="pl-10"
              aria-label="Buscar coincidencias"
              autoFocus
            />
          </div>
          {debounced.length >= 2 && (
            <div className="mt-3">
              {matches.isLoading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Buscando…
                </p>
              ) : (matches.data ?? []).length === 0 ? (
                <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  No hay coincidencias para «{debounced}». Puedes capturarlo como nuevo abajo.
                </p>
              ) : (
                <ul className="divide-y rounded-2xl border">
                  {(matches.data ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {m.sku ?? "Borrador"}
                          </span>
                          <span className="truncate text-sm font-semibold">{m.product_name}</span>
                          {m.variant_label && (
                            <span className="text-sm text-muted-foreground">
                              · {m.variant_label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {m.counted_locations > 0
                            ? `${formatNumber(m.total_quantity, 3)} ${m.unit_plural} · ${m.location_names}`
                            : "Pendiente de conteo"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/inventario/$variantId" params={{ variantId: m.id }}>
                            Abrir
                          </Link>
                        </Button>
                        {m.record_status === "registered" && (
                          <Button size="sm" variant="outline" onClick={() => openCount(m.id)}>
                            Contar en otra ubicación
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => chooseExistingFrom(m.id)}
                        >
                          <Plus /> Nueva variante
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <div ref={formRef} className="scroll-mt-24 space-y-6">
        {loadingSource ? (
          <div className="surface-card flex items-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando registro…
          </div>
        ) : (
          <>
            <section className="surface-card p-5" aria-labelledby="producto-titulo">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="producto-titulo" className="text-lg font-bold">
                  {editing ? "Producto" : "2. Producto o modelo"}
                </h2>
                {existing && !editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const t = types.find((x) => x.id === existing.typeId);
                      setExisting(null);
                      setProduct({
                        ...emptyProduct(),
                        typeId: t?.id ?? null,
                        categoryId: existing.categoryId,
                      });
                      applyType(t);
                      if (search.producto) navigate({ to: "/capturar", search: {}, replace: true });
                    }}
                  >
                    Capturar un producto nuevo
                  </Button>
                )}
              </div>

              {existing && !updateProduct ? (
                <div className="rounded-2xl bg-sky/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-foreground/80">
                    Variante de un producto existente
                  </p>
                  <p className="mt-1 text-lg font-bold">{existing.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {type?.name ?? "Sin tipo"} ·{" "}
                    {treePath(categories, categoryForDisplay) ?? "Por clasificar"}
                  </p>
                </div>
              ) : null}

              {showProductForm && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="p-name">
                      Nombre del producto <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="p-name"
                      value={product.name}
                      maxLength={160}
                      onChange={(e) => setProduct({ ...product, name: e.target.value })}
                      aria-invalid={!!errors["product.name"]}
                      placeholder="Ej. Listón satinado liso"
                      autoComplete="off"
                    />
                    {errors["product.name"] && <FieldError>{errors["product.name"]}</FieldError>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-type">
                      Tipo de producto <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={product.typeId ?? NONE}
                      onValueChange={(v) => {
                        const t = types.find((x) => x.id === v);
                        setProduct({ ...product, typeId: t?.id ?? null });
                        if (existing && updateProduct)
                          setExisting({ ...existing, typeId: t?.id ?? null });
                        applyType(t, true);
                      }}
                    >
                      <SelectTrigger id="p-type" aria-invalid={!!errors["product.type"]}>
                        <SelectValue placeholder="Elige el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {types.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors["product.type"] && <FieldError>{errors["product.type"]}</FieldError>}
                    <p className="text-xs text-muted-foreground">
                      Define qué características se piden.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cat-0">Categoría</Label>
                    <CategoryPicker
                      items={categories}
                      value={product.categoryId}
                      onChange={(id) => setProduct({ ...product, categoryId: id })}
                    />
                    {recents.categories.length > 0 && (
                      <RecentChips
                        label="Recientes"
                        ids={recents.categories}
                        items={categories}
                        active={product.categoryId}
                        onPick={(id) => setProduct({ ...product, categoryId: id })}
                      />
                    )}
                  </div>
                </div>
              )}
            </section>

            {type && (
              <>
                {sharedDefs.length > 0 && (
                  <section className="surface-card p-5" aria-labelledby="carac-titulo">
                    <h2 id="carac-titulo" className="text-lg font-bold">
                      {editing ? "Características" : "3. Características comunes"}
                    </h2>
                    <p className="mb-4 text-sm text-muted-foreground">
                      Aplican a todas las variantes de este guardado. Si no conoces un dato, márcalo
                      como pendiente: no lo inventes.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {sharedDefs.map((d) => (
                        <AttributeInput
                          key={d.id}
                          def={d}
                          value={shared[d.id] ?? emptyAttr(d)}
                          onChange={(v) => setShared((prev) => ({ ...prev, [d.id]: v }))}
                          measureUnits={measureUnits}
                          error={errors[`shared.${d.id}`]}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <section className="surface-card p-5" aria-labelledby="var-titulo">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="var-titulo" className="text-lg font-bold">
                        {editing ? "Variante y unidad" : "4. Variantes, cantidad y ubicación"}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Cada variante recibe su propio SKU. La ubicación no crea variantes nuevas.
                      </p>
                    </div>
                    {!editing && rowDefs.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setCombosOpen(true)}>
                        <Grid3x3 /> Crear varias en tabla
                      </Button>
                    )}
                  </div>

                  <div className="mb-5 grid gap-4 rounded-2xl bg-muted/50 p-4 md:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="u-base">
                        Unidad base <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={baseUnitId ?? NONE}
                        onValueChange={(v) => setBaseUnitId(v === NONE ? null : v)}
                      >
                        <SelectTrigger id="u-base" aria-invalid={!!errors["unit"]}>
                          <SelectValue placeholder="Elige" />
                        </SelectTrigger>
                        <SelectContent>
                          {inventoryUnits.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name_plural}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors["unit"] && <FieldError>{errors["unit"]}</FieldError>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-pres">Presentación (opcional)</Label>
                      <Select
                        value={presentationUnitId ?? NONE}
                        onValueChange={(v) => setPresentationUnitId(v === NONE ? null : v)}
                      >
                        <SelectTrigger id="u-pres">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Sin presentación</SelectItem>
                          {inventoryUnits
                            .filter((u) => u.id !== baseUnitId)
                            .map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name_singular}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-factor">
                        {presentationUnit
                          ? `${baseUnit?.name_plural ?? "Unidades"} por ${presentationUnit.name_singular}`
                          : "Contenido por presentación"}
                      </Label>
                      <Input
                        id="u-factor"
                        inputMode="decimal"
                        value={factor}
                        disabled={!presentationUnit}
                        onChange={(e) => setFactor(e.target.value)}
                        placeholder={presentationUnit ? "Vacío = se desconoce" : "—"}
                        aria-invalid={!!errors["factor"]}
                      />
                      {errors["factor"] && <FieldError>{errors["factor"]}</FieldError>}
                    </div>
                    {!editingRegistered && (
                      <div className="space-y-1.5">
                        <Label htmlFor="loc">Ubicación del conteo</Label>
                        <TreeSelect
                          id="loc"
                          items={locations}
                          value={locationId}
                          onChange={setLocationId}
                          placeholder="Elige la ubicación"
                          ariaInvalid={!!errors["location"]}
                        />
                        {errors["location"] && <FieldError>{errors["location"]}</FieldError>}
                        {recents.locations.length > 0 && (
                          <RecentChips
                            label="Recientes"
                            ids={recents.locations}
                            items={locations}
                            active={locationId}
                            onPick={setLocationId}
                          />
                        )}
                      </div>
                    )}
                    {presentationUnit && factorNum === null && (
                      <p className="text-xs text-muted-foreground md:col-span-4">
                        Como no se conoce cuántos {baseUnit?.name_plural} trae cada{" "}
                        {presentationUnit.name_singular}, solo podrás capturar el total en{" "}
                        {baseUnit?.name_plural}.
                      </p>
                    )}
                  </div>

                  <ol className="space-y-3">
                    {rows.map((r, i) => {
                      const auto = buildVariantLabel(rowDefs, r.attrs, units);
                      const c = computeCount(r.count, factorNum, baseUnit?.allows_decimal ?? true);
                      return (
                        <li key={r.key} className="rounded-2xl border bg-card p-4">
                          <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-full bg-graphite text-xs font-bold text-graphite-foreground">
                              {i + 1}
                            </span>
                            <Input
                              value={r.labelTouched ? r.label : auto}
                              onChange={(e) =>
                                updateRow(r.key, { label: e.target.value, labelTouched: true })
                              }
                              placeholder="Nombre de la variante (se arma solo)"
                              aria-label={`Nombre de la variante ${i + 1}`}
                              className="h-9 max-w-sm flex-1"
                              maxLength={160}
                            />
                            {r.labelTouched && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => updateRow(r.key, { labelTouched: false, label: "" })}
                              >
                                Automático
                              </Button>
                            )}
                            <div className="ml-auto flex gap-1">
                              {!editing && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title="Duplicar fila"
                                  aria-label={`Duplicar variante ${i + 1}`}
                                  onClick={() =>
                                    setRows((prev) => {
                                      const copy: Row = {
                                        ...r,
                                        key: newKey(),
                                        id: undefined,
                                        label: "",
                                        labelTouched: false,
                                        count: emptyCount(),
                                        attrs: Object.fromEntries(
                                          Object.entries(r.attrs).map(([k, v]) => [k, { ...v }]),
                                        ) as Record<string, AttrValue>,
                                      };
                                      const next = [...prev];
                                      next.splice(i + 1, 0, copy);
                                      return next;
                                    })
                                  }
                                >
                                  <Copy />
                                </Button>
                              )}
                              {rows.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Quitar variante ${i + 1}`}
                                  onClick={() =>
                                    setRows((prev) => prev.filter((x) => x.key !== r.key))
                                  }
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            {rowDefs.map((d) => (
                              <AttributeInput
                                key={d.id}
                                def={d}
                                value={r.attrs[d.id] ?? emptyAttr(d)}
                                onChange={(v) =>
                                  updateRow(r.key, (row) => ({
                                    attrs: { ...row.attrs, [d.id]: v },
                                  }))
                                }
                                measureUnits={measureUnits}
                                error={errors[`row.${r.key}.${d.id}`]}
                              />
                            ))}
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor={`sup-${r.key}`}>Código de proveedor</Label>
                              <Input
                                id={`sup-${r.key}`}
                                value={r.supplierCode}
                                maxLength={60}
                                onChange={(e) => updateRow(r.key, { supplierCode: e.target.value })}
                                autoComplete="off"
                              />
                            </div>
                          </div>

                          {!editingRegistered && (
                            <div className="mt-4 rounded-xl bg-muted/50 p-3">
                              <div className="flex flex-wrap items-end gap-3">
                                {factorNum !== null && presentationUnit ? (
                                  <>
                                    <div className="w-36 space-y-1">
                                      <Label htmlFor={`full-${r.key}`} className="text-xs">
                                        {presentationUnit.name_plural} completos
                                      </Label>
                                      <Input
                                        id={`full-${r.key}`}
                                        inputMode="numeric"
                                        value={r.count.full}
                                        disabled={r.count.pending}
                                        onChange={(e) =>
                                          updateRow(r.key, (row) => ({
                                            count: {
                                              ...row.count,
                                              full: e.target.value,
                                              quantity: "",
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                    <div className="w-36 space-y-1">
                                      <Label htmlFor={`loose-${r.key}`} className="text-xs">
                                        {baseUnit?.name_plural} sueltos
                                      </Label>
                                      <Input
                                        id={`loose-${r.key}`}
                                        inputMode="decimal"
                                        value={r.count.loose}
                                        disabled={r.count.pending}
                                        onChange={(e) =>
                                          updateRow(r.key, (row) => ({
                                            count: {
                                              ...row.count,
                                              loose: e.target.value,
                                              quantity: "",
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                    <span className="pb-2 text-xs text-muted-foreground">
                                      o total:
                                    </span>
                                  </>
                                ) : null}
                                <div className="w-40 space-y-1">
                                  <Label htmlFor={`qty-${r.key}`} className="text-xs">
                                    Cantidad ({baseUnit?.name_plural ?? "unidad base"})
                                  </Label>
                                  <Input
                                    id={`qty-${r.key}`}
                                    inputMode="decimal"
                                    value={r.count.quantity}
                                    disabled={r.count.pending}
                                    placeholder="0 = contado sin existencia"
                                    onChange={(e) =>
                                      updateRow(r.key, (row) => ({
                                        count: {
                                          ...row.count,
                                          quantity: e.target.value,
                                          full: "",
                                          loose: "",
                                        },
                                      }))
                                    }
                                    aria-invalid={!!errors[`row.${r.key}.count`]}
                                  />
                                </div>
                                <label className="flex items-center gap-2 pb-2 text-sm">
                                  <Checkbox
                                    checked={r.count.pending}
                                    onCheckedChange={(v) =>
                                      updateRow(r.key, (row) => ({
                                        count: { ...row.count, pending: v === true },
                                      }))
                                    }
                                  />
                                  Pendiente de conteo
                                </label>
                                {c.ok && !c.pending && (
                                  <span className="pb-2 text-sm font-semibold tabular">
                                    = {formatNumber(c.total, 3)}{" "}
                                    {c.total === 1
                                      ? baseUnit?.name_singular
                                      : baseUnit?.name_plural}
                                  </span>
                                )}
                              </div>
                              {errors[`row.${r.key}.count`] && (
                                <FieldError>{errors[`row.${r.key}.count`]}</FieldError>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {!editing && (
                    <Button
                      variant="outline"
                      className="mt-3"
                      onClick={() => setRows((prev) => [...prev, newRow(rowDefs)])}
                    >
                      <Plus /> Agregar variante
                    </Button>
                  )}
                </section>

                <Collapsible
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  className="surface-card p-5"
                >
                  <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
                    <span className="text-lg font-bold">Información adicional</span>
                    <ChevronDown
                      className={cn("size-5 transition-transform", moreOpen && "rotate-180")}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 grid gap-4 md:grid-cols-2">
                    {showProductForm && (
                      <>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label htmlFor="p-desc">Descripción breve</Label>
                          <Textarea
                            id="p-desc"
                            value={product.description}
                            maxLength={1000}
                            onChange={(e) =>
                              setProduct({ ...product, description: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="p-tags">Usos o aplicaciones (separados por coma)</Label>
                          <Input
                            id="p-tags"
                            value={product.tags}
                            onChange={(e) => setProduct({ ...product, tags: e.target.value })}
                            placeholder="Ej. moños, escolar, regalo"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="p-notes">Observaciones del producto</Label>
                          <Input
                            id="p-notes"
                            value={product.notes}
                            maxLength={2000}
                            onChange={(e) => setProduct({ ...product, notes: e.target.value })}
                          />
                        </div>
                      </>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="v-legacy">Código anterior</Label>
                      <Input
                        id="v-legacy"
                        value={legacyCode}
                        maxLength={60}
                        onChange={(e) => setLegacyCode(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="v-notes">Observaciones de la variante</Label>
                      <Input
                        id="v-notes"
                        value={variantNotes}
                        maxLength={2000}
                        onChange={(e) => setVariantNotes(e.target.value)}
                      />
                    </div>
                    {!editingRegistered && (
                      <div className="space-y-1.5">
                        <Label htmlFor="c-ref">Referencia de captura</Label>
                        <Input
                          id="c-ref"
                          value={captureRef}
                          maxLength={80}
                          onChange={(e) => setCaptureRef(e.target.value)}
                          placeholder="Ej. Hoja 3, renglón 12"
                        />
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}

            {!type && !typesLoading && (
              <div className="surface-card p-8 text-center text-sm text-muted-foreground">
                <PackagePlus className="mx-auto mb-2 size-8" aria-hidden />
                Elige el tipo de producto para ver las características que corresponden.
              </div>
            )}
          </>
        )}
      </div>

      {/* Barra de guardado siempre accesible */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-3 py-3 shadow-card backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
          {!editing && (
            <label className="mr-auto flex items-center gap-2 text-sm">
              <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
              <span>
                Conservar tipo, categoría y ubicación
                {keep && (type || locationId) && (
                  <span className="hidden text-xs text-muted-foreground md:inline">
                    {" "}
                    (
                    {[
                      type?.name,
                      treePath(categories, categoryForDisplay) ?? "Por clasificar",
                      treePath(locations, locationId),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    )
                  </span>
                )}
              </span>
            </label>
          )}
          {formError && (
            <p
              className={cn("text-sm font-medium text-destructive", editing && "mr-auto")}
              role="alert"
            >
              {formError}
            </p>
          )}
          {(!editing || editing.status === "draft") && (
            <Button variant="outline" onClick={saveDraft} disabled={busy || !type}>
              {save.isPending && save.variables === "draft" && <Loader2 className="animate-spin" />}{" "}
              Guardar borrador
            </Button>
          )}
          <Button onClick={() => void openSummary()} disabled={busy || !type} title="Ctrl + Enter">
            {(checking || (save.isPending && save.variables === "registered")) && (
              <Loader2 className="animate-spin" />
            )}
            {editingRegistered
              ? "Revisar y guardar cambios"
              : editing
                ? "Revisar y confirmar"
                : "Revisar y guardar"}
          </Button>
        </div>
      </div>

      <Dialog open={!!summary} onOpenChange={(o) => !o && !save.isPending && setSummary(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resumen antes de confirmar</DialogTitle>
            <DialogDescription>
              Revisa los datos. El SKU se genera cuando el servidor confirme el guardado.
            </DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl bg-muted/50 p-4">
                <dt className="text-muted-foreground">Producto</dt>
                <dd className="font-semibold">
                  {existing && !updateProduct ? existing.name : product.name}
                </dd>
                <dt className="text-muted-foreground">Tipo</dt>
                <dd>{type?.name}</dd>
                <dt className="text-muted-foreground">Categoría</dt>
                <dd>{treePath(categories, categoryForDisplay) ?? "Por clasificar"}</dd>
                <dt className="text-muted-foreground">Unidad base</dt>
                <dd>
                  {baseUnit?.name_plural}
                  {presentationUnit &&
                    ` · ${presentationUnit.name_singular} de ${factorNum !== null ? formatNumber(factorNum) : "contenido desconocido"}`}
                </dd>
                {!editingRegistered && (
                  <>
                    <dt className="text-muted-foreground">Ubicación</dt>
                    <dd>{treePath(locations, locationId) ?? "—"}</dd>
                  </>
                )}
              </dl>
              <ul className="divide-y rounded-2xl border">
                {rows.map((r, i) => {
                  const c = computeCount(r.count, factorNum, baseUnit?.allows_decimal ?? true);
                  const dupE = summary.dupExisting.get(i);
                  const dupB = summary.dupBatch.has(i);
                  return (
                    <li
                      key={r.key}
                      className={cn("px-4 py-3", (dupE || dupB) && "bg-destructive/5")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          {i + 1}. {rowLabel(r) || "Sin nombre de variante"}
                        </span>
                        {!editingRegistered && (
                          <span className="tabular">
                            {c.ok && !c.pending
                              ? `${formatNumber(c.total, 3)} ${c.total === 1 ? baseUnit?.name_singular : baseUnit?.name_plural}`
                              : "Pendiente de conteo"}
                          </span>
                        )}
                      </div>
                      {dupE && (
                        <p className="mt-1 text-destructive" role="alert">
                          Ya existe con las mismas características:{" "}
                          <Link
                            to="/inventario/$variantId"
                            params={{ variantId: dupE.id }}
                            className="font-semibold underline"
                          >
                            {dupE.sku ?? "borrador"} {dupE.label ?? ""}
                          </Link>
                          . Ábrelo en lugar de duplicarlo.
                        </p>
                      )}
                      {dupB && (
                        <p className="mt-1 text-destructive" role="alert">
                          Esta combinación se repite en otra fila de este guardado.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSummary(null)} disabled={save.isPending}>
              Seguir editando
            </Button>
            <Button
              onClick={() => save.mutate("registered")}
              disabled={
                save.isPending ||
                !!(summary && (summary.dupBatch.size > 0 || summary.dupExisting.size > 0))
              }
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              {editingRegistered
                ? "Guardar cambios"
                : editing
                  ? "Confirmar y generar SKU"
                  : "Guardar y capturar siguiente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CombinationsDialog
        open={combosOpen}
        onOpenChange={setCombosOpen}
        defs={rowDefs}
        measureUnits={measureUnits}
        onAdd={addCombos}
      />
      <CountDialog target={countTarget} onClose={() => setCountTarget(null)} />
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-destructive" role="alert">
      {children}
    </p>
  );
}

function RecentChips({
  label,
  ids,
  items,
  active,
  onPick,
}: {
  label: string;
  ids: string[];
  items: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    sort_order: number;
    depth: number;
    is_active: boolean;
  }>;
  active: string | null;
  onPick: (id: string) => void;
}) {
  const valid = ids.filter((id) => items.some((i) => i.id === id && i.is_active));
  if (valid.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}:</span>
      {valid.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onPick(id)}
          className={cn(
            "max-w-[220px] truncate rounded-full border px-2 py-0.5 text-[11px]",
            active === id ? "border-primary bg-primary/20" : "border-border hover:bg-muted",
          )}
          title={treePath(items, id) ?? ""}
        >
          {treePath(items, id)}
        </button>
      ))}
    </div>
  );
}
