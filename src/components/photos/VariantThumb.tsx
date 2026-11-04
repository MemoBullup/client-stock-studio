import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";

import { useSignedUrls, variantImagesQuery } from "@/lib/photos";
import { cn } from "@/lib/utils";

/** Miniatura principal de una variante, o marcador «Sin fotografía». */
export function VariantThumb({
  variantId,
  alt,
  className,
}: {
  variantId: string;
  alt: string;
  className?: string;
}) {
  const { data } = useQuery(variantImagesQuery(variantId));
  const primary = data?.find((i) => i.is_primary) ?? data?.[0];
  const path = primary ? (primary.thumbnail_path ?? primary.storage_path) : null;
  const urls = useSignedUrls([path]);
  const src = path ? urls.data?.get(path) : undefined;
  return <PhotoThumb src={src} alt={alt} className={className} />;
}

export function PhotoThumb({
  src,
  alt,
  className,
}: {
  src?: string | undefined;
  alt: string;
  className?: string | undefined;
}) {
  if (src)
    return (
      <img
        src={src}
        alt={alt}
        className={cn("shrink-0 rounded-2xl object-cover", className)}
        loading="lazy"
      />
    );
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground",
        className,
      )}
      title="Sin fotografía"
    >
      <ImageOff className="size-1/3 max-h-6 max-w-6" aria-hidden />
      <span className="sr-only">Sin fotografía</span>
    </div>
  );
}
