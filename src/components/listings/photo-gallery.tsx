"use client";

import { ChevronLeft, ChevronRight, Grid2x2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Photo } from "@/components/ui/photo";
import { cn } from "@/lib/cn";

type GalleryPhoto = { url: string; caption: string | null };

/** Hero mosaic (1 large + 4 small) with a full-screen, keyboard- and swipe-friendly lightbox. */
export function PhotoGallery({ photos, alt }: { photos: GalleryPhoto[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  const step = useCallback(
    (dir: 1 | -1) => setOpen((i) => (i === null ? i : (i + dir + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  const touchX = useRef<number | null>(null);

  if (!photos.length) {
    return (
      <Photo src={null} alt={alt} className="aspect-[16/7] w-full rounded-[var(--radius-card)]" />
    );
  }

  const tiles = photos.slice(0, 5);
  return (
    <>
      <div className="relative grid h-[42vh] min-h-72 grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[var(--radius-card)] sm:h-[56vh] sm:max-h-[560px]">
        {tiles.map((p, i) => (
          <button
            key={p.url + i}
            type="button"
            onClick={() => setOpen(i)}
            className={cn(
              "group relative overflow-hidden bg-sunken",
              i === 0 ? "col-span-4 row-span-2 md:col-span-2" : "hidden md:block",
              tiles.length === 2 && i === 1 && "md:col-span-2 md:row-span-2",
              tiles.length === 3 && i > 0 && "md:col-span-2",
            )}
            aria-label={`Open photo ${i + 1} of ${photos.length}`}
          >
            <Photo
              src={p.url}
              alt={i === 0 ? alt : (p.caption ?? `${alt} — photo ${i + 1}`)}
              priority={i === 0}
              sizes={i === 0 ? "(min-width: 768px) 50vw, 100vw" : "25vw"}
              className="size-full transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <span className="absolute inset-0 bg-shade/0 transition-colors group-hover:bg-shade/10" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="absolute right-4 bottom-4 flex items-center gap-2 rounded-full bg-surface/95 px-4 py-2 text-sm font-semibold text-ink shadow-card backdrop-blur hover:bg-surface"
        >
          <Grid2x2 className="size-4" />
          {photos.length} photos
        </button>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-shade/95 p-0 text-white backdrop:bg-transparent"
      >
        {open !== null && (
          <div
            className="flex h-full flex-col"
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
              touchX.current = null;
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
              <p className="text-sm text-white/70">
                {open + 1} / {photos.length}
                {photos[open].caption && (
                  <span className="ml-3 text-white">{photos[open].caption}</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-full p-2 hover:bg-white/10"
                aria-label="Close photos"
              >
                <X className="size-6" />
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
              <Photo
                key={photos[open].url}
                src={photos[open].url}
                alt={photos[open].caption ?? `${alt} — photo ${open + 1}`}
                sizes="100vw"
                priority
                className="max-h-full max-w-full animate-fade-in rounded-lg object-contain"
                fallbackClassName="h-2/3 w-full max-w-4xl"
              />
              {photos.length > 1 && (
                <>
                  <LightboxArrow side="left" onClick={() => step(-1)} />
                  <LightboxArrow side="right" onClick={() => step(1)} />
                </>
              )}
            </div>
            <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-4 sm:justify-center">
              {photos.map((p, i) => (
                <button
                  key={p.url + i}
                  type="button"
                  onClick={() => setOpen(i)}
                  className={cn(
                    "h-14 w-20 shrink-0 overflow-hidden rounded-md opacity-50 transition-opacity hover:opacity-100",
                    i === open && "opacity-100 ring-2 ring-white",
                  )}
                  aria-label={`Show photo ${i + 1}`}
                >
                  <Photo src={p.url} alt="" sizes="80px" className="size-full" />
                </button>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function LightboxArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={cn(
        "absolute top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 sm:flex",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-6" />
    </button>
  );
}
