import { createFileRoute, redirect } from "@tanstack/react-router";

// La aplicación es privada: la raíz lleva al inicio, que a su vez pide acceso si no hay sesión.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aly · Inventario" },
      { name: "description", content: "Plataforma de inventario de Aly — Creaciones con estilo." },
      { property: "og:title", content: "Aly · Inventario" },
      {
        property: "og:description",
        content: "Plataforma de inventario de Aly — Creaciones con estilo.",
      },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/inicio" });
  },
});
