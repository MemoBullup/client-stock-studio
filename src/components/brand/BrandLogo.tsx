import logoDark from "@/assets/aly-logo-dark.png.asset.json";
import logoLight from "@/assets/aly-logo-light.png.asset.json";
import { useBranding } from "@/lib/session";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  /** "dark" = trazo oscuro para fondos claros; "light" = trazo claro para paneles grafito. */
  tone?: "dark" | "light";
  className?: string;
}

export function BrandLogo({ tone = "dark", className }: BrandLogoProps) {
  const { data } = useBranding();
  const name = data?.businessName ?? "Aly";
  if (data?.isCustomLogo) {
    return (
      <img
        src={data.logoUrl}
        alt={`Logotipo de ${name}`}
        className={cn("object-contain", tone === "light" && "rounded-xl bg-card p-1", className)}
      />
    );
  }
  return (
    <img
      src={tone === "light" ? logoLight.url : logoDark.url}
      alt={`Logotipo de ${name}`}
      className={cn("object-contain", className)}
    />
  );
}
