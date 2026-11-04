import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Boxes,
  MessageCircleQuestion,
  Camera,
  FileSpreadsheet,
  FolderTree,
  Home,
  LogOut,
  Menu,
  PackagePlus,
  ScanLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/brand/BrandLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useLowStockSummary } from "@/lib/alerts";
import { ROLE_LABEL, useSettings, type Me } from "@/lib/session";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  short: string;
  icon: LucideIcon;
  to?:
    | "/inicio"
    | "/capturar"
    | "/inventario"
    | "/asistente"
    | "/catalogos"
    | "/informes"
    | "/usuarios";
  adminOnly?: boolean;
  /** Bloque en el que se habilita; si existe, aún no está disponible. */
  upcoming?: string;
}

const NAV: NavItem[] = [
  { label: "Inicio", short: "Inicio", icon: Home, to: "/inicio" },
  { label: "Capturar SKU", short: "Capturar", icon: PackagePlus, to: "/capturar" },
  { label: "Inventario", short: "Inventario", icon: Boxes, to: "/inventario" },
  {
    label: "Asistente de inventario",
    short: "Asistente",
    icon: MessageCircleQuestion,
    to: "/asistente",
  },
  { label: "Pendientes de fotografía", short: "Fotografía", icon: Camera, upcoming: "D" },
  {
    label: "Categorías y ubicaciones",
    short: "Catálogos",
    icon: FolderTree,
    to: "/catalogos",
    adminOnly: true,
  },
  { label: "Informes", short: "Informes", icon: FileSpreadsheet, to: "/informes", adminOnly: true },
  {
    label: "Usuarios y configuración",
    short: "Usuarios",
    icon: Users,
    to: "/usuarios",
    adminOnly: true,
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const isAdmin = me.role === "admin";
  const { data: alerts } = useLowStockSummary();
  const below = alerts?.below ?? 0;
  const items = NAV.filter((i) => !i.adminOnly || isAdmin);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: settings } = useSettings();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen pb-10">
      {settings?.is_demo_environment && (
        <div className="print:hidden bg-brand-pink-soft text-center text-xs font-medium text-foreground py-1.5 px-4 border-b border-brand-pink/40">
          Entorno de demostración · Los registros marcados como <strong>DEMO</strong> son ficticios
          y pueden retirarse sin afectar los datos reales.
        </div>
      )}
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 print:hidden">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 rounded-full bg-card/85 px-3 py-2 shadow-card backdrop-blur-md sm:px-4">
          <Link to="/inicio" className="flex shrink-0 items-center" aria-label="Ir a inicio">
            <BrandLogo className="h-10 w-auto sm:h-11" />
          </Link>

          <nav aria-label="Navegación principal" className="mx-auto hidden lg:block">
            <ul className="flex items-center gap-1 rounded-full bg-graphite p-1.5">
              {items.map((item) => {
                const Icon = item.icon;
                if (!item.to) {
                  return (
                    <li key={item.label}>
                      <span
                        aria-disabled="true"
                        title={`${item.label}: disponible en el bloque ${item.upcoming}`}
                        className="flex cursor-not-allowed items-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-medium text-graphite-muted/70"
                      >
                        <Icon className="size-3.5" aria-hidden />
                        <span className="sr-only 2xl:not-sr-only">{item.short}</span>
                        <span className="hidden rounded-full border border-graphite-border px-1.5 text-[10px] leading-4 2xl:inline">
                          Próx.
                        </span>
                      </span>
                    </li>
                  );
                }
                const active = pathname.startsWith(item.to);
                return (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      title={item.label}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-graphite-foreground hover:bg-graphite-soft",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {item.short}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Link
              to="/escanear"
              className={cn(
                "flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:brightness-95",
                pathname.startsWith("/escanear") && "ring-2 ring-primary",
              )}
              aria-label="Escanear QR de una etiqueta"
              title="Escanear QR"
            >
              <ScanLine className="size-4" aria-hidden />
            </Link>
            <Link
              to="/alertas"
              className={cn(
                "relative flex size-10 items-center justify-center rounded-full transition hover:brightness-95",
                below > 0
                  ? "bg-warning-soft text-warning-foreground"
                  : "bg-muted text-muted-foreground",
                pathname.startsWith("/alertas") && "ring-2 ring-primary",
              )}
              aria-label={
                below > 0
                  ? `Alertas de existencias: ${below} SKU bajo mínimo`
                  : "Alertas de existencias: sin alertas"
              }
              title="Alertas de existencias"
            >
              <Bell className="size-4" aria-hidden />
              {below > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-graphite px-1 text-[10px] font-bold text-primary tabular">
                  {below > 99 ? "99+" : below}
                </span>
              )}
            </Link>
            <Badge
              variant={isAdmin ? "graphite" : "secondary"}
              className="hidden sm:inline-flex lg:hidden 2xl:inline-flex"
            >
              {me.role ? ROLE_LABEL[me.role] : "Sin rol"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex size-10 items-center justify-center rounded-full bg-sky text-sm font-bold text-sky-foreground ring-2 ring-card transition hover:brightness-95"
                  aria-label="Menú de la cuenta"
                >
                  {initials(me.fullName) || "?"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                <DropdownMenuLabel className="font-normal">
                  <div className="font-semibold">{me.fullName}</div>
                  <div className="text-xs text-muted-foreground">{me.email}</div>
                  <div className="mt-1 text-xs">{me.role ? ROLE_LABEL[me.role] : "Sin rol"}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut} className="gap-2">
                  <LogOut className="size-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="graphite"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Abrir menú"
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[300px] border-none bg-graphite text-graphite-foreground"
              >
                <SheetHeader>
                  <SheetTitle className="text-graphite-foreground">Menú</SheetTitle>
                </SheetHeader>
                <ul className="mt-4 flex flex-col gap-1 px-2">
                  {items.map((item) => {
                    const Icon = item.icon;
                    if (!item.to) {
                      return (
                        <li
                          key={item.label}
                          aria-disabled="true"
                          className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-graphite-muted/70"
                        >
                          <Icon className="size-4" aria-hidden /> {item.label}
                          <span className="ml-auto rounded-full border border-graphite-border px-2 text-[10px]">
                            Bloque {item.upcoming}
                          </span>
                        </li>
                      );
                    }
                    const active = pathname.startsWith(item.to);
                    return (
                      <li key={item.label}>
                        <Link
                          to={item.to}
                          onClick={() => setOpen(false)}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-graphite-soft",
                          )}
                        >
                          <Icon className="size-4" aria-hidden /> {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-6 max-w-[1400px] px-3 sm:px-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
