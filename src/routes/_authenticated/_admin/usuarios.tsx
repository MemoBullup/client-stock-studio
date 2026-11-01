import { createFileRoute } from "@tanstack/react-router";

import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { PageHeader } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/_admin/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuarios y configuración · Aly Inventario" },
      { name: "description", content: "Gestiona el personal autorizado, sus roles y la configuración del negocio." },
      { property: "og:title", content: "Usuarios y configuración · Aly Inventario" },
      { property: "og:description", content: "Gestiona el personal autorizado, sus roles y la configuración del negocio." },
    ],
  }),
  component: UsuariosPage,
});

const tabClass =
  "rounded-full px-5 py-2 text-graphite-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

function UsuariosPage() {
  return (
    <>
      <PageHeader
        title="Usuarios y configuración"
        description="Crea cuentas autorizadas, asigna roles y ajusta los datos del negocio, el formato de SKU y las etiquetas."
      />
      <Tabs defaultValue="users">
        <TabsList className="mb-4 h-auto rounded-full bg-graphite p-1.5">
          <TabsTrigger value="users" className={tabClass}>
            Usuarios
          </TabsTrigger>
          <TabsTrigger value="settings" className={tabClass}>
            Configuración
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsPanel />
        </TabsContent>
      </Tabs>
    </>
  );
}
