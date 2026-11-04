import { useMemo } from "react";

import { qrPath } from "@/lib/qr";
import { cn } from "@/lib/utils";

/** QR en SVG nítido para pantalla e impresión. Los módulos usan el color del texto. */
export function QrSvg({ value, className, title }: { value: string; className?: string; title?: string }) {
  const { size, path } = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("bg-card text-foreground", className)}
      role="img"
      aria-label={title ?? "Código QR"}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
