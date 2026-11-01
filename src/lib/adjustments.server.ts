// Propuesta de ajuste de inventario con Lovable AI. Solo servidor.
// El modelo SOLO elige entre SKU y ubicaciones que el usuario ya puede ver;
// nunca recibe costos y su propuesta nunca se aplica sin confirmación humana.
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, jsonSchema, NoObjectGeneratedError, Output, streamText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayRunIdFetch } from "@/lib/ai/run-id.server";
import { pathOf, type TreeItem } from "@/lib/tree";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

export type AdjustmentMode = "set" | "increase" | "decrease";

export interface CandidateDTO {
  id: string;
  sku: string | null;
  productName: string;
  variantLabel: string | null;
  attributes: string;
  unitSingular: string;
  unitPlural: string;
  allowsDecimal: boolean;
  unitsPerPresentation: number | null;
}

export interface ProposalDTO {
  variantId: string | null;
  locationId: string | null;
  mode: AdjustmentMode | null;
  quantity: number | null;
  reason: string;
  confidence: "alta" | "media" | "baja";
  explanation: string;
  missingInfo: string[];
}

export type ProposeResult =
  | {
      ok: true;
      proposal: ProposalDTO;
      candidates: CandidateDTO[];
      stock: Array<{ variantId: string; locationId: string; quantity: number }>;
    }
  | { ok: false; error: string; candidates: CandidateDTO[] };

interface ModelOutput {
  variant_code: string | null;
  location_code: string | null;
  mode: AdjustmentMode | null;
  quantity: number | null;
  reason: string;
  confidence: "alta" | "media" | "baja";
  explanation: string;
  missing_info: string[];
}

const outputSchema = jsonSchema<ModelOutput>({
  type: "object",
  additionalProperties: false,
  required: ["variant_code", "location_code", "mode", "quantity", "reason", "confidence", "explanation", "missing_info"],
  properties: {
    variant_code: { type: ["string", "null"], description: "Código V# del SKU elegido o null" },
    location_code: { type: ["string", "null"], description: "Código L# de la ubicación o null" },
    mode: { type: ["string", "null"], enum: ["set", "increase", "decrease", null] },
    quantity: { type: ["number", "null"], description: "Cantidad en la unidad base del SKU" },
    reason: { type: "string", description: "Motivo breve en español para el historial" },
    confidence: { type: "string", enum: ["alta", "media", "baja"] },
    explanation: { type: "string", description: "Explicación breve en español de la propuesta" },
    missing_info: { type: "array", items: { type: "string" } },
  },
});

const INSTRUCTIONS = `Eres el asistente de inventario de una tienda de listones, aplicaciones decorativas, dijes y productos impresos en México.
El usuario describe en texto libre un ajuste de inventario. Debes proponer exactamente un SKU, una ubicación y una cantidad.

Reglas obligatorias:
- Elige el SKU solo de la lista CANDIDATOS (código V#) y la ubicación solo de la lista UBICACIONES (código L#). Nunca inventes códigos.
- Si hay ambigüedad real (por ejemplo, el color o el ancho no se mencionan y hay varias opciones), deja el campo en null y explica qué falta en missing_info.
- mode: "set" cuando el texto indica cuánto HAY en total ("hay 12", "quedan 5", "conté 30"); "increase" cuando llegan o aparecen unidades ("llegaron 3", "encontré 2 más"); "decrease" cuando se pierden, dañan, venden o faltan unidades ("se dañaron 4", "faltan 2").
- quantity siempre en la unidad base del SKU (piezas, metros, paquetes…). Convierte rollos a metros solo si el SKU indica metros por rollo; si no se conoce, deja quantity en null y explícalo.
- Si la unidad base no admite decimales, no propongas fracciones.
- Usa EXISTENCIAS para entender la situación actual; no dejes existencias negativas.
- reason: motivo corto y claro en español (máx. 120 caracteres). explanation: 1-2 frases en español.
- confidence: "alta" solo si SKU, ubicación y cantidad quedan claros sin suponer nada.`;

function friendlyGatewayError(error: unknown): string {
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  if (status === 402) return "Se agotaron los créditos de IA del espacio de trabajo. Pide al responsable que agregue créditos.";
  if (status === 429) return "El asistente recibió demasiadas solicitudes. Espera un momento e intenta de nuevo.";
  if (status === 403) return "El asistente de IA no está disponible para este espacio de trabajo en este momento.";
  if (status === 401) return "El asistente de IA no está configurado correctamente.";
  if (status && status >= 500) return "El asistente de IA no respondió. Intenta de nuevo en unos segundos.";
  return "No se pudo generar una propuesta. Intenta describir el ajuste de otra forma o captúralo manualmente.";
}

export async function proposeAdjustment(
  supabase: SupabaseClient<Database>,
  text: string,
): Promise<ProposeResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false, error: "El asistente de IA no está configurado.", candidates: [] };

  // 1. Candidatos visibles para este usuario (RLS) — sin costos.
  const candRes = await supabase.rpc("suggest_variant_candidates", { _text: text, _limit: 30 });
  if (candRes.error) throw new Error(candRes.error.message);
  const rows = candRes.data ?? [];

  const ids = rows.map((r) => r.id);
  const [varRes, locRes, stockRes] = await Promise.all([
    ids.length
      ? supabase.from("variants").select("id, units_per_presentation").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; units_per_presentation: number | null }[], error: null }),
    supabase.from("locations").select("id, parent_id, name, sort_order, depth, is_active"),
    ids.length
      ? supabase.from("stock_levels").select("variant_id, location_id, quantity").in("variant_id", ids)
      : Promise.resolve({ data: [] as { variant_id: string; location_id: string; quantity: number }[], error: null }),
  ]);
  if (varRes.error) throw new Error(varRes.error.message);
  if (locRes.error) throw new Error(locRes.error.message);
  if (stockRes.error) throw new Error(stockRes.error.message);

  const perPres = new Map((varRes.data ?? []).map((v) => [v.id, v.units_per_presentation]));
  const candidates: CandidateDTO[] = rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    productName: r.product_name,
    variantLabel: r.variant_label,
    attributes: r.attributes,
    unitSingular: r.unit_singular,
    unitPlural: r.unit_plural,
    allowsDecimal: r.allows_decimal,
    unitsPerPresentation: perPres.get(r.id) != null ? Number(perPres.get(r.id)) : null,
  }));

  if (candidates.length === 0) {
    return {
      ok: false,
      error: "No encontré ningún SKU confirmado que coincida con la descripción. Menciona el nombre, color, medida o SKU.",
      candidates: [],
    };
  }

  const locations = (locRes.data ?? []) as TreeItem[];
  const activeLocations = locations.filter((l) => l.is_active);
  const stock = (stockRes.data ?? []).map((s) => ({
    variantId: s.variant_id,
    locationId: s.location_id,
    quantity: Number(s.quantity),
  }));

  // 2. Códigos cortos: el modelo no puede inventar identificadores reales.
  const vCode = new Map(candidates.map((c, i) => [`V${i + 1}`, c]));
  const lCode = new Map(activeLocations.map((l, i) => [`L${i + 1}`, l]));
  const vCodeById = new Map([...vCode].map(([k, c]) => [c.id, k]));
  const lCodeById = new Map([...lCode].map(([k, l]) => [l.id, k]));

  const candText = [...vCode]
    .map(([code, c]) => {
      const conv = c.unitsPerPresentation ? ` | ${c.unitsPerPresentation} ${c.unitPlural} por rollo` : "";
      return `${code} | ${c.sku ?? "sin SKU"} | ${c.productName}${c.variantLabel ? ` · ${c.variantLabel}` : ""} | unidad base: ${c.unitSingular}${c.allowsDecimal ? " (admite decimales)" : " (solo enteros)"}${conv} | ${c.attributes || "sin atributos"}`;
    })
    .join("\n");
  const locText = [...lCode].map(([code, l]) => `${code} | ${pathOf(locations, l.id, " > ")}`).join("\n");
  const stockText =
    stock
      .map((s) => {
        const v = vCodeById.get(s.variantId);
        const l = lCodeById.get(s.locationId);
        return v && l ? `${v} en ${l}: ${s.quantity}` : null;
      })
      .filter(Boolean)
      .join("\n") || "Sin conteos registrados para estos candidatos.";

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  let streamError: unknown = null;
  let output: ModelOutput;
  try {
    const result = streamText({
      model: provider.responses(MODEL),
      instructions: INSTRUCTIONS,
      messages: [
        {
          role: "user",
          content: `DESCRIPCIÓN DEL AJUSTE:\n${text}\n\nCANDIDATOS:\n${candText}\n\nUBICACIONES:\n${locText}\n\nEXISTENCIAS ACTUALES:\n${stockText}`,
        },
      ],
      output: Output.object({ schema: outputSchema }),
      maxRetries: 1,
      onError: ({ error }) => {
        streamError = error;
      },
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    output = await result.output;
  } catch (error) {
    const cause = streamError ?? error;
    console.error("[ajuste-ia]", NoObjectGeneratedError.isInstance(error) ? "sin objeto" : cause);
    return { ok: false, error: friendlyGatewayError(cause), candidates };
  }

  // 3. Validación en servidor: solo códigos existentes y cantidades coherentes.
  const chosen = output.variant_code ? vCode.get(output.variant_code.trim().toUpperCase()) : undefined;
  const loc = output.location_code ? lCode.get(output.location_code.trim().toUpperCase()) : undefined;
  const missing = [...(output.missing_info ?? [])].slice(0, 5);
  let quantity = typeof output.quantity === "number" && Number.isFinite(output.quantity) ? output.quantity : null;
  if (quantity !== null && quantity < 0) quantity = null;
  if (quantity !== null && chosen && !chosen.allowsDecimal && !Number.isInteger(quantity)) {
    missing.push(`La unidad «${chosen.unitSingular}» solo admite enteros; revisa la cantidad.`);
    quantity = null;
  }
  const mode = output.mode === "set" || output.mode === "increase" || output.mode === "decrease" ? output.mode : null;

  // Pone primero los candidatos más relevantes para que el usuario pueda corregir.
  const ordered = chosen ? [chosen, ...candidates.filter((c) => c.id !== chosen.id)] : candidates;

  return {
    ok: true,
    proposal: {
      variantId: chosen?.id ?? null,
      locationId: loc?.id ?? null,
      mode,
      quantity,
      reason: (output.reason ?? "").trim().slice(0, 200) || "Ajuste descrito por el usuario",
      confidence: chosen && loc && mode && quantity !== null ? output.confidence : "baja",
      explanation: (output.explanation ?? "").trim().slice(0, 400),
      missingInfo: missing,
    },
    candidates: ordered.slice(0, 15),
    stock: stock.filter((s) => ordered.slice(0, 15).some((c) => c.id === s.variantId)),
  };
}
