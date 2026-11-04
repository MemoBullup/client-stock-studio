import { Camera, ImagePlus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { validatePhoto } from "@/lib/photos";

export interface QueuedPhoto {
  key: string;
  file: File;
  preview: string;
  /** Fila (variante) del formulario a la que se ligará al guardar. */
  rowKey: string | null;
}

/**
 * Fotos elegidas durante la captura. Se suben cuando el servidor confirma el guardado
 * y quedan ligadas a la variante elegida (no se asume que una foto sirve para todas).
 */
export function PhotoQueue({
  photos,
  onChange,
  rows,
  disabled,
}: {
  photos: QueuedPhoto[];
  onChange: (next: QueuedPhoto[]) => void;
  rows: Array<{ key: string; label: string }>;
  disabled?: boolean;
}) {
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  function add(files: File[]) {
    const next: QueuedPhoto[] = [];
    for (const f of files) {
      const problem = validatePhoto(f);
      if (problem) {
        toast.error(problem);
        continue;
      }
      next.push({
        key: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        rowKey: rows[0]?.key ?? null,
      });
    }
    if (next.length) onChange([...photos, ...next].slice(0, 20));
  }

  const inputProps = {
    type: "file" as const,
    accept: "image/jpeg,image/png,image/webp",
    className: "hidden",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      add(files);
    },
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input ref={pickRef} multiple {...inputProps} />
        <input ref={camRef} capture="environment" {...inputProps} />
        <Button
          type="button"
          variant="outline"
          onClick={() => pickRef.current?.click()}
          disabled={disabled}
        >
          <ImagePlus /> Elegir fotos
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => camRef.current?.click()}
          disabled={disabled}
        >
          <Camera /> Tomar foto
        </Button>
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Opcional. Las fotos se suben al confirmar el guardado; la primera de cada SKU queda como
          principal.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.key} className="overflow-hidden rounded-2xl border bg-muted/40">
              <div className="relative aspect-square">
                <img
                  src={p.preview}
                  alt={`Foto por subir: ${p.file.name}`}
                  className="size-full object-cover"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="graphite"
                  className="absolute right-1.5 top-1.5"
                  aria-label={`Quitar ${p.file.name}`}
                  onClick={() => {
                    URL.revokeObjectURL(p.preview);
                    onChange(photos.filter((x) => x.key !== p.key));
                  }}
                  disabled={disabled}
                >
                  <X />
                </Button>
              </div>
              {rows.length > 1 && (
                <label className="block p-2 text-xs">
                  <span className="sr-only">Variante de esta foto</span>
                  <select
                    className="h-8 w-full rounded-lg border bg-card px-2 text-xs"
                    value={p.rowKey ?? ""}
                    onChange={(e) =>
                      onChange(
                        photos.map((x) => (x.key === p.key ? { ...x, rowKey: e.target.value } : x)),
                      )
                    }
                    disabled={disabled}
                  >
                    {rows.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
