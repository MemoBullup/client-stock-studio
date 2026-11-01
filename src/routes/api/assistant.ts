import { createFileRoute } from "@tanstack/react-router";

import { handleAssistantChat } from "@/lib/assistant/chat.server";

// Endpoint de streaming del asistente. Verifica la sesión del usuario en cada solicitud.
export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      POST: ({ request }) => handleAssistantChat(request),
    },
  },
});
