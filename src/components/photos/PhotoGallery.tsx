import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Camera, ImagePlus, Loader2, Star, Trash2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PHOTO_LABEL } from "@/lib/catalog";
import { friendlyError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  deleteVariantPhoto,
  uploadVariantPhoto,
  useSignedUrls,
  validatePhoto,
  variantImagesQuery,
} from "@/lib/photos";

type PhotoStatus = "pending" | "uploaded" | "approved";

export function PhotoGallery({
  variantId,
  photoStatus,
  canManage,
  isAdmin,
  meId,
  altDefault,
  onChanged,
}: {
  variantId: string;
  photoStatus: PhotoStatus;
  canManage: boolean;
  isAdmin: boolean;
  meId: string | undefined;
  altDefault: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const images = useQuery(variantImagesQuery(variantId));
  const list = images.data ?? [];
  const urls = useSignedUrls(
    list.flatMap((i) => [i.thumbnail_path ?? i.storage_path, i.storage_path]),
  );
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["variant-images", variantId] });
    qc.invalidateQueries({ queryKey: ["catalog", "search"] });
    onChanged();
  };

  async function upload(files: File[]) {
    const bad = files.map(validatePhoto).filter(Boolean);
    bad.forEach((m) => toast.error(m!));
    const ok = files.filter((f) => !validatePhoto(f));
    if (!ok.length) return;
    setProgress({ done: 0, total: ok.length });
    let done = 0;
    for (const f of ok) {
      try {
        await uploadVariantPhoto(variantId, f, altDefault);
        done++;
      } catch (e) {
        toast.error(friendlyError(e));
      }
      setProgress({ done, total: ok.length });
    }
    setProgress(null);
    if (done) toast.success(done === 1 ? "Fotografía guardada" : `${done} fotografías guardadas`);
    refresh();
  }

  const setPrimary = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("set_primary_image", { _image_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: deleteVariantPhoto,
    onSuccess: () => {
      toast.success("Fotografía eliminada");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const review = useMutation({
    mutationFn: async (status: PhotoStatus) => {
      const { error } = await supabase
        .from("variants")
        .update({ photo_status: status })
        .eq("id", variantId);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      toast.success(
        status === "approved" ? "Fotografías aprobadas" : "Fotografías marcadas por revisar",
      );
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const inputProps = {
    type: "file" as const,
    accept: "image/jpeg,image/png,image/webp",
    className: "hidden",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length) void upload(files);
    },
  };

  return (
    <section className="surface-card p-5 lg:col-span-3" aria-labelledby="fotos-titulo">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="fotos-titulo" className="text-lg font-bold">
          Fotografías
        </h2>
        <Badge
          variant={
            photoStatus === "approved" ? "success" : photoStatus === "uploaded" ? "info" : "muted"
          }
        >
          {PHOTO_LABEL[photoStatus]}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && (
            <>
              <input ref={pickRef} multiple {...inputProps} />
              <input ref={camRef} capture="environment" {...inputProps} />
              <Button size="sm" onClick={() => pickRef.current?.click()} disabled={!!progress}>
                {progress ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                {progress ? `Subiendo ${progress.done + 1} de ${progress.total}` : "Subir fotos"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => camRef.current?.click()}
                disabled={!!progress}
              >
                <Camera /> Tomar foto
              </Button>
            </>
          )}
          {isAdmin && list.length > 0 && photoStatus !== "approved" && (
            <Button
              size="sm"
              variant="graphite"
              onClick={() => review.mutate("approved")}
              disabled={review.isPending}
            >
              <BadgeCheck /> Aprobar fotografías
            </Button>
          )}
          {isAdmin && photoStatus === "approved" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => review.mutate("uploaded")}
              disabled={review.isPending}
            >
              <Undo2 /> Marcar por revisar
            </Button>
          )}
        </div>
      </div>

      {images.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando fotografías…
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
          Sin fotografías.{" "}
          {canManage
            ? "Sube fotos o tómalas con la cámara; la primera queda como principal."
            : photoStatus === "approved"
              ? ""
              : "Solo quien capturó el SKU o el Administrador puede agregarlas."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {list.map((img) => {
            const src = urls.data?.get(img.thumbnail_path ?? img.storage_path);
            const full = urls.data?.get(img.storage_path);
            const mine = img.uploaded_by === meId;
            return (
              <li key={img.id} className="overflow-hidden rounded-2xl border bg-muted/40">
                <a
                  href={full}
                  target="_blank"
                  rel="noreferrer"
                  className="block aspect-square bg-muted"
                >
                  {src ? (
                    <img
                      src={src}
                      alt={img.alt_text ?? altDefault}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </span>
                  )}
                </a>
                <div className="flex items-center gap-1 p-2">
                  {img.is_primary ? (
                    <Badge variant="default" className="gap-1">
                      <Star className="fill-current" /> Principal
                    </Badge>
                  ) : canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setPrimary.mutate(img.id)}
                    >
                      <Star /> Principal
                    </Button>
                  ) : null}
                  <span className="sr-only">Subida el {formatDateTime(img.uploaded_at)}</span>
                  {canManage && (isAdmin || mine) && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="ml-auto"
                      aria-label="Eliminar fotografía"
                      onClick={() => {
                        if (confirm("¿Eliminar esta fotografía?")) remove.mutate(img);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
