// Fotografías de producto: archivo original + miniatura en el almacenamiento privado,
// ligadas al identificador estable de la variante (no al SKU, nombre ni categoría).
import { queryOptions, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const PHOTO_BUCKET = "product-photos";
export const MAX_PHOTO_MB = 15;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Mensaje de error en español si la foto no se puede subir; null si es válida. */
export function validatePhoto(file: { type: string; size: number; name: string }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return `«${file.name}»: usa fotos JPG, PNG o WEBP.`;
  }
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
    return `«${file.name}» pesa más de ${MAX_PHOTO_MB} MB.`;
  }
  return null;
}

async function makeThumbnail(file: File, max = 480): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.82));
  } catch {
    return null; // sin miniatura se muestra el original
  }
}

export async function uploadVariantPhoto(variantId: string, file: File, altText: string) {
  const problem = validatePhoto(file);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const original = `${variantId}/${id}.${ext}`;
  const thumbPath = `${variantId}/${id}-mini.webp`;
  const storage = supabase.storage.from(PHOTO_BUCKET);
  const up = await storage.upload(original, file, { contentType: file.type });
  if (up.error) throw up.error;
  const thumb = await makeThumbnail(file);
  let thumbnail: string | null = null;
  if (thumb) {
    const t = await storage.upload(thumbPath, thumb, { contentType: "image/webp" });
    if (!t.error) thumbnail = thumbPath;
  }
  const { error } = await supabase.from("variant_images").insert({
    variant_id: variantId,
    storage_path: original,
    thumbnail_path: thumbnail,
    alt_text: altText.slice(0, 300) || null,
  });
  if (error) {
    await storage.remove([original, ...(thumbnail ? [thumbnail] : [])]);
    throw error;
  }
}

export async function deleteVariantPhoto(img: { id: string; storage_path: string; thumbnail_path: string | null }) {
  const { error } = await supabase.from("variant_images").delete().eq("id", img.id);
  if (error) throw error;
  await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([img.storage_path, ...(img.thumbnail_path ? [img.thumbnail_path] : [])]);
}

export function variantImagesQuery(variantId: string) {
  return queryOptions({
    queryKey: ["variant-images", variantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variant_images")
        .select("id, storage_path, thumbnail_path, alt_text, is_primary, sort_order, uploaded_by, uploaded_at")
        .eq("variant_id", variantId)
        .order("is_primary", { ascending: false })
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** URL firmadas (privadas, 1 hora) para mostrar varias fotos de una vez. */
export function useSignedUrls(paths: Array<string | null | undefined>) {
  const list = Array.from(new Set(paths.filter((p): p is string => !!p))).sort();
  return useQuery({
    queryKey: ["signed-photos", list],
    enabled: list.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(list, 3600);
      if (error) throw error;
      const out = new Map<string, string>();
      for (const d of data ?? []) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
      return out;
    },
  });
}
