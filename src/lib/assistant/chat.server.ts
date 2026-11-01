// Asistente de inventario: una conversación por persona, guardada en la base de datos.
import { createOpenAI } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import { APICallError, convertToModelMessages, isStepCount, streamText, type UIMessage } from "ai";

import type { Database, Json } from "@/integrations/supabase/types";
import { createLovableAiGatewayRunIdFetch, withLovableAiGatewayRunIdHeader } from "@/lib/ai/run-id.server";
import { createInventoryTools } from "@/lib/assistant/tools.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
const HISTORY_LIMIT = 40;
const MAX_QUESTION = 2000;

function instructions() {
  const today = new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeZone: "America/Mexico_City" }).format(new Date());
  return `Eres el asistente de inventario de Aly — Creaciones con estilo (listones, aplicaciones decorativas, dijes y productos impresos), en México. Hoy es ${today}.
Respondes preguntas en español sobre existencias, niveles mínimos y ubicaciones usando SIEMPRE las herramientas, que leen los datos actuales.

Reglas:
- Nunca inventes SKU, cantidades, ubicaciones ni mínimos. Si una herramienta no devuelve el dato, dilo con claridad.
- Antes de afirmar algo sobre un producto, búscalo (buscar_skus) o consulta su SKU exacto (existencias_de_sku).
- Siempre escribe la cantidad con su unidad ("35.5 metros", "12 piezas"). Nunca sumes unidades distintas (metros + piezas).
- "Pendiente de conteo" significa que no se ha contado; es distinto de cero. Una alerta solo existe si la cantidad contada es menor al mínimo.
- No tienes acceso a costos, precios ni valoración del inventario: si te los piden, explica que esa información no está disponible en este asistente.
- No puedes modificar el inventario. Para ajustes, indica que usen «Ajustes asistidos»; para mínimos, «Alertas de existencias».
- Los SKU que empiezan con DEMO- son datos ficticios de demostración.
- Sé breve y claro. Usa listas o tablas en markdown cuando haya varios resultados. Menciona el SKU de cada producto.`;
}

function friendlyError(error: unknown): string {
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  if (status === 402) return "Se agotaron los créditos de IA del espacio de trabajo. Pide al responsable que agregue créditos.";
  if (status === 429) return "El asistente recibió demasiadas preguntas seguidas. Espera un momento e intenta de nuevo.";
  if (status === 403) return "El asistente de IA no está disponible para este espacio de trabajo en este momento.";
  if (status && status >= 500) return "El asistente no respondió. Intenta de nuevo en unos segundos.";
  return "No se pudo completar la respuesta. Intenta de nuevo.";
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });

function createUserClient(token: string) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Falta la configuración del servidor");
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

function isValidUserMessage(m: unknown): m is UIMessage {
  if (!m || typeof m !== "object") return false;
  const msg = m as UIMessage;
  if (msg.role !== "user" || typeof msg.id !== "string" || !Array.isArray(msg.parts)) return false;
  const text = msg.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
  return text.trim().length > 0 && text.length <= MAX_QUESTION && msg.parts.every((p) => p.type === "text");
}

export async function handleAssistantChat(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.split(".").length !== 3) return json(401, "Tu sesión expiró. Vuelve a iniciar sesión.");

  const supabase = createUserClient(token);
  const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
  const userId = claims?.claims?.sub;
  if (claimsError || !userId) return json(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
  const { data: isStaff } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!isStaff) return json(403, "Tu cuenta no tiene acceso al inventario.");

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, "El asistente de IA no está configurado.");

  let body: { messages?: unknown[] };
  try {
    body = (await request.json()) as { messages?: unknown[] };
  } catch {
    return json(400, "Solicitud inválida.");
  }
  const incoming = Array.isArray(body.messages) ? body.messages.at(-1) : undefined;
  if (!isValidUserMessage(incoming)) return json(400, "Escribe una pregunta (máximo 2000 caracteres).");
  const userMessage: UIMessage = { id: incoming.id.slice(0, 200), role: "user", parts: incoming.parts };

  // Historial guardado del servidor (no se confía en el historial enviado por el navegador).
  const stored = await supabase
    .from("assistant_messages")
    .select("message")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (stored.error) return json(500, "No se pudo leer el historial de la conversación.");
  const history = (stored.data ?? []).map((r) => r.message as unknown as UIMessage).reverse().filter((m) => m.id !== userMessage.id);

  const saveUser = await supabase
    .from("assistant_messages")
    .upsert(
      { user_id: userId, message_id: userMessage.id, role: "user", message: userMessage as unknown as Json },
      { onConflict: "user_id,message_id" },
    );
  if (saveUser.error) return json(500, "No se pudo guardar tu pregunta. Intenta de nuevo.");

  const uiMessages = [...history, userMessage];
  // Las piezas de razonamiento de turnos anteriores no se reenvían (no son necesarias y pueden caducar).
  const forModel = uiMessages.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type !== "reasoning") }));
  const tools = createInventoryTools(supabase);

  const runIdFetch = createLovableAiGatewayRunIdFetch(request.headers.get("X-Lovable-AIG-Run-ID") ?? undefined);
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    instructions: instructions(),
    messages: await convertToModelMessages(forModel, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: isStepCount(50),
    maxRetries: 1,
    abortSignal: request.signal,
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

  const response = result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    generateMessageId: () => crypto.randomUUID(),
    sendReasoning: true,
    onError: (error) => {
      console.error("[asistente]", error);
      return friendlyError(error);
    },
    onEnd: async ({ responseMessage }) => {
      if (!responseMessage?.id || responseMessage.parts.length === 0) return;
      const { error } = await supabase.from("assistant_messages").upsert(
        {
          user_id: userId,
          message_id: responseMessage.id,
          role: "assistant",
          message: responseMessage as unknown as Json,
        },
        { onConflict: "user_id,message_id" },
      );
      if (error) console.error("[asistente] no se guardó la respuesta", error.message);
    },
  });
  return withLovableAiGatewayRunIdHeader(response, runIdFetch, { "Cache-Control": "no-store" });
}
