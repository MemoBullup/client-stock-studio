import { createFileRoute, redirect } from "@tanstack/react-router";

// Destino estable de los QR impresos: /q/<id> → ficha del SKU.
// La ficha está protegida: sin sesión pide acceso y luego regresa al producto.
export const Route = createFileRoute("/q/$variantId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/inventario/$variantId", params: { variantId: params.variantId }, replace: true });
  },
  head: () => ({
    meta: [
      { title: "Abriendo ficha · Aly Inventario" },
      { name: "description", content: "Abre la ficha del SKU escaneado." },
      { property: "og:title", content: "Ficha del SKU · Aly Inventario" },
      { property: "og:description", content: "Abre la ficha del SKU escaneado." },
    ],
  }),
});
