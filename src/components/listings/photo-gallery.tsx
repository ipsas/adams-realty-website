"use client";

import { ChevronLeft, ChevronRight, Grid2x2, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useDialogHistory } from "@/components/ui/dialog";
import { Photo } from "@/components/ui/photo";
import { cn } from "@/lib/cn";
import {
  arrowStep,
  centerTarget,
  pageTarget,
  pagerDisabled,
  pagerFallback,
  pagerKey,
  stripEdges,
  wheelDelta,
} from "./photo-strip";

type GalleryPhoto = { url: string; caption: string | null };

const motion = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * Hero mosaic (1 large + 4 small) with a full-screen, keyboard- and swipe-friendly lightbox.
 * Opening the lightbox adds a same-URL history entry, so Back (or Android's back gesture)
 * closes it and stays on the listing; closing it any other way removes that entry again.
 */
export function PhotoGallery({ photos, alt }: { photos: GalleryPhoto[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogHistory(open !== null, () => setOpen(null));

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
      const dir = arrowStep(e);
      if (dir === null) return;
      // Otherwise a focused thumbnail also nudges the strip, cancelling its scroll to the new photo.
      e.preventDefault();
      step(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  const touchX = useRef<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const stripId = useId();
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const isOpen = open !== null;
  const prevPager = useRef<HTMLButtonElement>(null);
  const nextPager = useRef<HTMLButtonElement>(null);
  // The focused pager about to be disabled. Noted before the render that disables it: once it
  // is, the browser has already moved focus to <body>.
  const refocus = useRef<1 | -1 | null>(null);

  useEffect(() => {
    const el = strip.current;
    if (!isOpen || !el) return;
    const update = () => {
      const next = stripEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      for (const dir of [-1, 1] as const) {
        const b = dir < 0 ? prevPager.current : nextPager.current;
        if (b && b === document.activeElement && pagerDisabled(dir, next)) refocus.current = dir;
      }
      setEdges(next);
    };
    // Native and non-passive: React's onWheel can't preventDefault. A mouse wheel scrolls the
    // strip sideways until it reaches an end, then falls through to the page as usual.
    const onWheel = (e: WheelEvent) => {
      const dx = wheelDelta(e.deltaX, e.deltaY, e.deltaMode, el.clientWidth);
      if (dx === null) return;
      const { atStart, atEnd } = stripEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      if (dx < 0 ? atStart : atEnd) return;
      e.preventDefault();
      el.scrollLeft += dx;
    };
    const resize = new ResizeObserver(update);
    resize.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    update();
    return () => {
      resize.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
    };
  }, [isOpen]);

  // Hand focus on from a pager that just disabled itself (WCAG 2.4.3).
  useEffect(() => {
    const dir = refocus.current;
    if (dir === null) return;
    refocus.current = null;
    const to = pagerFallback(dir, edges);
    const target =
      to === "thumb"
        ? strip.current?.querySelector<HTMLElement>('[aria-current="true"]')
        : to < 0
          ? prevPager.current
          : nextPager.current;
    target?.focus();
  }, [edges]);

  // Keep the active thumb centred. scrollTo, not scrollIntoView, which also scrolls the dialog.
  const positioned = useRef(false);
  useEffect(() => {
    const el = strip.current;
    if (open === null || !el) {
      positioned.current = false;
      return;
    }
    const thumb = el.querySelector<HTMLElement>('[aria-current="true"]');
    if (!thumb) return;
    const left = thumb.getBoundingClientRect().left - el.getBoundingClientRect().left;
    el.scrollTo({
      left: centerTarget(left + el.scrollLeft, thumb.offsetWidth, el.clientWidth, el.scrollWidth),
      behavior: positioned.current ? motion() : "auto",
    });
    positioned.current = true;
  }, [open]);

  const page = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const left = pageTarget(el.scrollLeft, el.clientWidth, el.scrollWidth, dir);
    el.scrollTo({ left, behavior: motion() });
  };

  if (!photos.length) {
    return (
      <Photo src={null} alt={alt} className="aspect-[16/7] w-full rounded-[var(--radius-card)]" />
    );
  }

  const tiles = photos.slice(0, 5);
  // On md+ the hero takes the left half and the rest fill the right half's four cells, so with
  // fewer than five photos some tiles widen to leave no empty cell: 2 → one tall tile,
  // 3 → two wide ones, 4 → two small ones over a wide one.
  const wide = (i: number) =>
    i > 0 && (tiles.length === 3 || (tiles.length === 4 && i === 3) || tiles.length === 2);
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
              // A single photo (a sold Georgia MLS listing shows only its primary one) fills the hero.
              i === 0
                ? cn("col-span-4 row-span-2", tiles.length > 1 && "md:col-span-2")
                : "hidden md:block",
              wide(i) && "md:col-span-2",
              tiles.length === 2 && i === 1 && "md:row-span-2",
            )}
            aria-label={`Open photo ${i + 1} of ${photos.length}`}
          >
            <Photo
              src={p.url}
              alt={i === 0 ? alt : (p.caption ?? `${alt} — photo ${i + 1}`)}
              priority={i === 0}
              // Phones load only the first photo: the other tiles are hidden there (a lazy
              // <img> that isn't displayed never loads). Photos past the mosaic load one at a
              // time in the viewer (site review #10).
              sizes={
                i === 0 && tiles.length > 1
                  ? "(min-width: 768px) 50vw, 100vw"
                  : i === 0
                    ? "100vw"
                    : wide(i)
                      ? "50vw"
                      : "25vw"
              }
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
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </button>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        aria-label={`Photos of ${alt}`}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-shade/95 p-0 text-white backdrop:bg-transparent"
      >
        {open !== null && (
          <div
            className="flex h-full flex-col"
            onTouchStart={(e) => {
              // Swiping the thumbnail strip scrolls it rather than changing the photo.
              const inStrip = strip.current?.contains(e.target as Node);
              touchX.current = inStrip ? null : e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
              touchX.current = null;
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
              <p className="text-sm text-white/70">
                <span aria-live="polite" aria-atomic="true" className="tabular-nums">
                  {open + 1} / {photos.length}
                </span>
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
            <div className="flex items-center gap-2 px-2 pb-4 sm:px-4">
              <StripPager
                ref={prevPager}
                dir={-1}
                controls={stripId}
                disabled={edges.atStart}
                onPage={page}
              />
              {/* Not justify-center: that pushes the first thumbs of a long strip out of reach.
                  The w-max inner row centres a short strip and starts a long one at the left. */}
              <div
                ref={strip}
                id={stripId}
                role="group"
                aria-label="Photo thumbnails"
                className="scrollbar-none min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain p-1"
              >
                <div className="mx-auto flex w-max gap-2">
                  {photos.map((p, i) => (
                    <button
                      key={p.url + i}
                      type="button"
                      onClick={() => setOpen(i)}
                      className={cn(
                        "h-14 w-20 shrink-0 overflow-hidden rounded-md opacity-50 transition-opacity hover:opacity-100",
                        i === open && "opacity-100 ring-2 ring-white",
                      )}
                      aria-current={i === open ? "true" : undefined}
                      aria-label={`Show photo ${i + 1} of ${photos.length}`}
                    >
                      <Photo src={p.url} alt="" sizes="80px" className="size-full" />
                    </button>
                  ))}
                </div>
              </div>
              <StripPager
                ref={nextPager}
                dir={1}
                controls={stripId}
                disabled={edges.atEnd}
                onPage={page}
              />
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

/** Pages the thumbnail strip; hidden (but still taking its space) at either end. */
function StripPager({
  ref,
  dir,
  controls,
  disabled,
  onPage,
}: {
  ref: Ref<HTMLButtonElement>;
  dir: 1 | -1;
  controls: string;
  disabled: boolean;
  onPage: (dir: 1 | -1) => void;
}) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  // The activation key pressed while this pager had focus (see pagerKey).
  const held = useRef<string | null>(null);
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const type = e.type === "keyup" ? "keyup" : "keydown";
    const r = pagerKey(held.current, { type, key: e.key, repeat: e.repeat });
    held.current = r.held;
    if (r.block) e.preventDefault();
  };
  return (
    <button
      ref={ref}
      type="button"
      onFocus={() => {
        held.current = null;
      }}
      onKeyDown={onKey}
      onKeyUp={onKey}
      onClick={() => onPage(dir)}
      disabled={disabled}
      aria-controls={controls}
      aria-label={dir < 0 ? "Scroll thumbnails left" : "Scroll thumbnails right"}
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-[background-color,opacity] hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0"
    >
      <Icon className="size-5" />
    </button>
  );
}
