import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, CameraOff, Loader2, ScanLine, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { RECORD_LABEL } from "@/lib/catalog";
import { variantIdFromScan } from "@/lib/qr";

export const Route = createFileRoute("/_authenticated/escanear")({
  head: () => ({
    meta: [
      { title: "Escanear QR · Aly Inventario" },
      { name: "description", content: "Lee el QR de una etiqueta con la cámara o busca por SKU." },
      { property: "og:title", content: "Escanear QR · Aly Inventario" },
      { property: "og:description", content: "Lee el QR de una etiqueta con la cámara o busca por SKU." },
    ],
  }),
  component: EscanearPage,
});

type CamState = "idle" | "starting" | "on" | "denied" | "unsupported" | "error";

function EscanearPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CamState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["scan-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_variants", { _q: debounced, _limit: 20 });
      if (error) throw error;
      return data ?? [];
    },
  });

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam((c) => (c === "on" || c === "starting" ? "idle" : c));
  }

  useEffect(() => stop, []);

  async function start() {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam("unsupported");
      return;
    }
    setCam("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setCam("on");
      const { default: jsQR } = await import("jsqr");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const tick = () => {
        if (!streamRef.current || !ctx) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const scale = Math.min(1, 720 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            const id = variantIdFromScan(code.data);
            if (id) {
              stop();
              navigate({ to: "/inventario/$variantId", params: { variantId: id } });
              return;
            }
            setNotice("Ese QR no es de una etiqueta de este inventario.");
          }
        }
        setTimeout(() => requestAnimationFrame(tick), 150);
      };
      requestAnimationFrame(tick);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setCam(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      stop();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Escanear QR"
        description="Apunta la cámara a la etiqueta para abrir la ficha del SKU. Si no hay cámara, búscalo por SKU o nombre."
      />

      <section className="surface-graphite overflow-hidden p-4 sm:p-5" aria-labelledby="cam-title">
        <h2 id="cam-title" className="sr-only">
          Cámara
        </h2>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-graphite-soft">
          <video
            ref={videoRef}
            className={cam === "on" ? "size-full object-cover" : "hidden"}
            muted
            playsInline
          />
          {cam === "on" && (
            <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-primary/90" aria-hidden />
          )}
          {cam !== "on" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {cam === "starting" ? (
                <Loader2 className="size-8 animate-spin text-primary" />
              ) : cam === "denied" || cam === "unsupported" || cam === "error" ? (
                <CameraOff className="size-8 text-graphite-muted" />
              ) : (
                <ScanLine className="size-10 text-primary" />
              )}
              <p className="max-w-sm text-sm text-graphite-muted">
                {cam === "denied"
                  ? "No se dio permiso para usar la cámara. Actívalo en el navegador o busca por SKU abajo."
                  : cam === "unsupported"
                    ? "Este dispositivo o navegador no permite usar la cámara aquí. Busca por SKU abajo."
                    : cam === "error"
                      ? "No se pudo encender la cámara. Intenta de nuevo o busca por SKU."
                      : "La cámara se usa solo mientras esta pantalla está abierta."}
              </p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {cam === "on" ? (
            <Button variant="graphite-ghost" onClick={stop}>
              <CameraOff /> Apagar cámara
            </Button>
          ) : (
            <Button onClick={start} disabled={cam === "starting"}>
              <Camera /> {cam === "idle" ? "Encender cámara" : "Intentar de nuevo"}
            </Button>
          )}
          {notice && <p className="text-sm text-graphite-muted" role="status">{notice}</p>}
        </div>
      </section>

      <section className="surface-card p-5" aria-labelledby="manual-title">
        <h2 id="manual-title" className="mb-3 text-lg font-bold">
          Buscar por SKU
        </h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ej. ALY-000123 o listón rojo"
            className="pl-10"
            aria-label="Buscar por SKU o nombre"
          />
        </div>
        {debounced.length >= 2 && (
          <div className="mt-3">
            {results.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando…
              </p>
            ) : (results.data ?? []).length === 0 ? (
              <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                No hay coincidencias para «{debounced}».
              </p>
            ) : (
              <ul className="divide-y rounded-2xl border">
                {(results.data ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      to="/inventario/$variantId"
                      params={{ variantId: r.id }}
                      className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-muted/50"
                    >
                      <span className="font-mono text-sm font-bold">{r.sku ?? "Borrador"}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {r.product_name}
                        {r.variant_label ? ` · ${r.variant_label}` : ""}
                      </span>
                      {r.record_status !== "registered" && (
                        <Badge variant="muted">{RECORD_LABEL[r.record_status]}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
