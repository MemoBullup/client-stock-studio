import { createFileRoute } from "@tanstack/react-router";

import { TreeManager } from "@/components/catalog/TreeManager";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/_admin/catalogos")({
  head: () => ({
    meta: [
      { title: "Categorías y ubicaciones · Aly Inventario" },
      { name: "description", content: "Administra el árbol de categorías comerciales y las ubicaciones físicas." },
      { property: "og:title", content: "Categorías y ubicaciones · Aly Inventario" },
      { property: "og:description", content: "Administra el árbol de categorías comerciales y las ubicaciones físicas." },
    ],
  }),
  component: CatalogosPage,
});

function CatalogosPage() {
  const { data: settings } = useSettings();
  return (
    <>
      <PageHeader
        title="Categorías y ubicaciones"
        description="Crea, renombra, mueve, ordena y desactiva. La categoría comercial, el tipo de producto y la ubicación física se manejan por separado."
      />
      <Tabs defaultValue="categories">
        <TabsList className="mb-4 h-auto rounded-full bg-graphite p-1.5">
          <TabsTrigger
            value="categories"
            className="rounded-full px-5 py-2 text-graphite-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Categorías
          </TabsTrigger>
          <TabsTrigger
            value="locations"
            className="rounded-full px-5 py-2 text-graphite-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Ubicaciones
          </TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <TreeManager kind="categories" maxDepth={settings?.max_category_depth ?? 4} />
        </TabsContent>
        <TabsContent value="locations">
          <TreeManager kind="locations" maxDepth={8} />
        </TabsContent>
      </Tabs>
    </>
  );
}
