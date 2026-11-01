import { useChat } from "@ai-sdk/react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  Boxes,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  TriangleAlert,
  ClipboardList,
  BarChart3,
  ListChecks,
  Clock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import butterfly from "@/assets/aly-mariposa.png.asset.json";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";

export const Route = createFileRoute("/_authenticated/asistente")({
  head: () => ({
    meta: [
      { title: "Asistente de inventario · Aly Inventario" },
      {
        name: "description",
        content: "Pregunta en lenguaje natural por existencias, mínimos y ubicaciones.",
      },
      { property: "og:title", content: "Asistente de inventario · Aly Inventario" },
      {
        property: "og:description",
        content: "Pregunta en lenguaje natural por existencias, mínimos y ubicaciones.",
      },
    ],
  }),
  component: AsistentePage,
});

const SUGGESTIONS = [
  "¿Qué SKU están por debajo de su mínimo?",
  "¿Cuánto listón arcoíris de 25 mm hay y dónde?",
  "¿Qué hay en la Caja 02?",
  "¿Qué productos faltan por contar?",
];

const TOOL_META: Record<string, { label: string; icon: typeof Boxes }> = {
  resumen_inventario: { label: "Resumen del inventario", icon: BarChart3 },
  buscar_skus: { label: "Búsqueda de SKU", icon: Search },
  existencias_de_sku: { label: "Existencias del SKU", icon: Boxes },
  alertas_bajo_minimo: { label: "Alertas bajo mínimo", icon: TriangleAlert },
  minimos_configurados: { label: "Mínimos configurados", icon: ListChecks },
  inventario_por_ubicacion: { label: "Inventario por ubicación", icon: MapPin },
  listar_ubicaciones: { label: "Ubicaciones", icon: ClipboardList },
  skus_pendientes_de_conteo: { label: "Pendientes de conteo", icon: Clock },
};

const historyQueryKey = ["assistant-history"];

function AsistentePage() {
  const history = useQuery({
    queryKey: historyQueryKey,
    queryFn: async (): Promise<UIMessage[]> => {
      const { data, error } = await supabase
        .from("assistant_messages")
        .select("message")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.message as unknown as UIMessage);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [chatKey, setChatKey] = useState(0);

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] max-w-4xl flex-col">
      {history.isLoading ? (
        <div
          className="surface-card flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" /> Cargando conversación…
        </div>
      ) : history.isError ? (
        <div
          role="alert"
          className="surface-card flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm"
        >
          No se pudo cargar la conversación. {friendlyError(history.error)}
          <Button variant="outline" onClick={() => history.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <ChatWindow
          key={chatKey}
          initialMessages={history.data ?? []}
          onReset={() => setChatKey((k) => k + 1)}
        />
      )}
    </div>
  );
}

function parseError(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* texto plano */
  }
  return friendlyError(error);
}

function ChatWindow({
  initialMessages,
  onReset,
}: {
  initialMessages: UIMessage[];
  onReset: () => void;
}) {
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/assistant",
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // El servidor usa su propio historial guardado; solo enviamos la pregunta nueva.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages: messages.slice(-1) },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    id: "asistente-inventario",
    messages: initialMessages,
    transport,
    onFinish: () => qc.setQueryData(historyQueryKey, undefined),
  });

  const busy = status === "submitted" || status === "streaming";
  const errorText = parseError(error);

  const focusInput = () =>
    containerRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  useEffect(() => {
    if (status === "ready" || status === "error") focusInput();
  }, [status]);

  function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (t.length > 2000) {
      toast.error("La pregunta es muy larga (máximo 2000 caracteres).");
      return;
    }
    clearError();
    void sendMessage({ text: t });
  }

  async function resetConversation() {
    setResetting(true);
    const { data: u } = await supabase.auth.getUser();
    const { error: delError } = await supabase
      .from("assistant_messages")
      .delete()
      .eq("user_id", u.user?.id ?? "");
    setResetting(false);
    setConfirmReset(false);
    if (delError) {
      toast.error(friendlyError(delError));
      return;
    }
    qc.setQueryData(historyQueryKey, []);
    onReset();
  }

  const last = messages.at(-1);
  const waitingForFirstToken =
    status === "submitted" || (status === "streaming" && last?.role === "user");

  return (
    <div ref={containerRef} className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <img src={butterfly.url} alt="" className="size-10 rounded-full bg-brand-pink-soft p-1" />
        <div className="min-w-0 flex-1">
          <h1 className="font-bold leading-tight">Asistente de inventario</h1>
          <p className="truncate text-xs text-muted-foreground">
            Responde con los datos actuales de existencias, mínimos y ubicaciones. No ve costos ni
            modifica nada.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)} disabled={busy}>
            <RotateCcw /> Nueva conversación
          </Button>
        )}
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-6 px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <img
                src={butterfly.url}
                alt=""
                className="size-16 rounded-full bg-brand-pink-soft p-2"
              />
              <div className="space-y-1">
                <h2 className="text-lg font-bold">¿Qué quieres saber del inventario?</h2>
                <p className="text-sm text-muted-foreground">
                  Pregunta como se lo dirías a un compañero.
                </p>
              </div>
              <div className="mt-2 flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border bg-muted px-3.5 py-2 text-sm hover:bg-accent"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((m, mi) => (
              <Message key={m.id} from={m.role}>
                <MessageContent className="group-[.is-user]:rounded-2xl group-[.is-user]:bg-graphite group-[.is-user]:text-graphite-foreground">
                  {m.parts.map((part, i) => {
                    const key = `${m.id}-${i}`;
                    if (part.type === "text") {
                      return m.role === "assistant" ? (
                        <MessageResponse key={key}>{part.text}</MessageResponse>
                      ) : (
                        <p key={key} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      );
                    }
                    if (part.type === "reasoning") {
                      const streamingThis =
                        busy && mi === messages.length - 1 && i === m.parts.length - 1;
                      if (!part.text.trim() && !streamingThis) return null;
                      return (
                        <Reasoning key={key} isStreaming={streamingThis} defaultOpen={false}>
                          <ReasoningTrigger />
                          <ReasoningContent>{part.text}</ReasoningContent>
                        </Reasoning>
                      );
                    }
                    if (isToolUIPart(part)) {
                      const name = part.type.replace(/^tool-/, "");
                      const meta = TOOL_META[name];
                      const Icon = meta?.icon ?? Boxes;
                      return (
                        <Tool key={key} defaultOpen={false} className="mb-0 rounded-2xl">
                          <ToolHeader
                            type={part.type as `tool-${string}`}
                            state={part.state}
                            title={meta?.label ?? name}
                            icon={<Icon className="size-4 text-muted-foreground" aria-hidden />}
                          />
                          <ToolContent>
                            <ToolInput input={part.input} />
                            <ToolOutput output={part.output} errorText={part.errorText} />
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {waitingForFirstToken && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Consultando el inventario…</Shimmer>
              </MessageContent>
            </Message>
          )}
          {errorText && (
            <div
              role="alert"
              className="rounded-2xl bg-warning-soft p-4 text-sm text-warning-foreground"
            >
              {errorText}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3 sm:p-4">
        <PromptInput onSubmit={(msg: PromptInputMessage) => send(msg.text ?? "")}>
          <PromptInputTextarea
            autoFocus
            maxLength={2000}
            placeholder="Ej. ¿Cuántos dijes de audífonos lila quedan en el mostrador?"
            aria-label="Pregunta para el asistente de inventario"
          />
          <PromptInputFooter className="justify-between">
            <span className="text-xs text-muted-foreground">
              Enter para enviar · Shift + Enter para nueva línea
            </span>
            <PromptInputSubmit
              status={status}
              onStop={stop}
              aria-label={busy ? "Detener" : "Enviar pregunta"}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Empezar una conversación nueva?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará el historial de tus preguntas. El inventario no cambia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void resetConversation();
              }}
              disabled={resetting}
            >
              {resetting && <Loader2 className="animate-spin" />} Borrar historial
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
