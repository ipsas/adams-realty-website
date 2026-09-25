"use client";

import { ChevronLeft, ChevronRight, GripVertical, ImagePlus, Star, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Photo } from "@/components/ui/photo";
import { cn } from "@/lib/cn";

export type PhotoValue = { url: string; caption: string | null };

type Item = { url: string; caption: string };

type Control = "grip" | "earlier" | "later" | "remove";

/** Which control should have focus once a move re-renders the grid. */
type FocusTarget = { url: string; control: Control } | "add";

const MAX_PHOTOS = 60;

const iconButton =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-soft transition-colors hover:bg-sunken hover:text-ink focus-visible:ring-3 focus-visible:ring-brand-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4";

function isHttpsUrl(v: string) {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** "images.example.com/…/front.jpg" — enough to tell links apart when previews can't load. */
function shortUrl(v: string) {
  try {
    const u = new URL(v);
    const file = u.pathname.split("/").filter(Boolean).pop();
    return file ? `${u.hostname}/…/${file}` : u.hostname;
  } catch {
    return v;
  }
}

/**
 * Listing photos: add by URL, caption, reorder (buttons, arrow keys on the
 * grip, or drag and drop) and pick the cover. Posts the list to the listing
 * form as JSON in one hidden field, so saving the form saves the photos.
 */
export function PhotoManager({
  name,
  initial,
  error,
}: {
  name: string;
  initial: PhotoValue[];
  error?: string;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    initial.map((p) => ({ url: p.url, caption: p.caption ?? "" })),
  );
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const focusAfter = useRef<FocusTarget | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  // Reordering moves DOM nodes, which drops focus; put it back on the moved photo.
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (!target) return;
    if (target === "add") {
      addRef.current?.focus();
      return;
    }
    const card = Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>("[data-photo-url]") ?? [],
    ).find((el) => el.dataset.photoUrl === target.url);
    const control =
      card?.querySelector<HTMLButtonElement>(`[data-control="${target.control}"]:not(:disabled)`) ??
      card?.querySelector<HTMLButtonElement>(`[data-control="grip"]`);
    control?.focus();
  }, [items]);

  const count = items.length;
  const label = (i: number) => (i === 0 ? "cover photo" : `photo ${i + 1} of ${count}`);

  function move(from: number, to: number, focus?: Control) {
    if (to < 0 || to >= count || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    focusAfter.current = focus ? { url: item.url, control: focus } : null;
    setItems(next);
    setAnnouncement(
      to === 0 ? "Photo is now the cover." : `Photo moved to position ${to + 1} of ${count}.`,
    );
  }

  function remove(index: number) {
    const next = items.filter((_, i) => i !== index);
    const neighbor = next[index] ?? next[index - 1];
    focusAfter.current = neighbor ? { url: neighbor.url, control: "remove" } : "add";
    setItems(next);
    setAnnouncement(`Photo removed. ${next.length} photo${next.length === 1 ? "" : "s"} left.`);
  }

  function add() {
    const tokens = draft.split(/\s+/).filter(Boolean);
    if (!tokens.length) return setAddError("Paste an https:// link to an image.");
    if (tokens.some((t) => t.length > 2_048))
      return setAddError("Photo links must be under 2,048 characters.");
    const invalid = tokens.filter((t) => !isHttpsUrl(t));
    if (invalid.length)
      return setAddError(
        `${invalid.length === 1 ? "That isn't" : `${invalid.length} links aren't`} a secure https:// image link.`,
      );
    const known = new Set(items.map((i) => i.url));
    const fresh = [...new Set(tokens)].filter((t) => !known.has(t));
    if (!fresh.length) return setAddError("That photo is already in the list.");
    const room = MAX_PHOTOS - count;
    if (room <= 0) return setAddError(`Listings can have up to ${MAX_PHOTOS} photos.`);
    const added = fresh.slice(0, room);
    setItems([...items, ...added.map((url) => ({ url, caption: "" }))]);
    setDraft("");
    setAddError(
      fresh.length > room ? `Only the first ${room} were added (${MAX_PHOTOS} max).` : null,
    );
    setAnnouncement(`Added ${added.length} photo${added.length === 1 ? "" : "s"}.`);
  }

  function onGripKey(e: KeyboardEvent, i: number) {
    const to =
      e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? i - 1
        : e.key === "ArrowRight" || e.key === "ArrowDown"
          ? i + 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    move(i, to, "grip");
  }

  const serialized = JSON.stringify(
    items.map((i) => ({ url: i.url, caption: i.caption.trim() || null })),
  );

  return (
    // Card layout follows the space the manager gets (it sits beside a sidebar on wide screens).
    <div className="@container flex flex-col gap-5">
      <input type="hidden" name={name} value={serialized} />

      <div>
        <label htmlFor={`${ids}-add`} className="text-sm font-medium text-ink-soft">
          Add photos by link
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input
            ref={addRef}
            id={`${ids}-add`}
            type="url"
            inputMode="url"
            value={draft}
            placeholder="https://…"
            autoComplete="off"
            aria-invalid={addError ? true : undefined}
            aria-describedby={`${ids}-add-hint`}
            onChange={(e) => {
              setDraft(e.target.value);
              if (addError) setAddError(null);
            }}
            onKeyDown={(e) => {
              // Enter adds the photo instead of submitting the whole listing form.
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="text-base sm:text-sm"
          />
          <Button variant="secondary" onClick={add} className="shrink-0">
            <ImagePlus /> Add photo
          </Button>
        </div>
        <p id={`${ids}-add-hint`} className="mt-1.5 text-xs text-muted">
          {addError ? (
            <span className="text-clay-600" role="alert">
              {addError}
            </span>
          ) : (
            <>
              Paste one or more https:// image links, separated by spaces or new lines. Direct
              uploads will be available once object storage is set up.
            </>
          )}
        </p>
      </div>

      {error && (
        <p className="text-sm text-clay-600" role="alert">
          {error}
        </p>
      )}

      {count === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="font-medium text-ink">No photos yet</p>
          <p className="mt-1 text-sm text-muted">
            The first photo becomes the cover shown on listing cards and search results.
          </p>
        </div>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-ink">
              {count} photo{count === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-muted">
              Drag, use the arrows, or focus the handle and press arrow keys to reorder.
            </span>
          </p>
          <ol
            ref={gridRef}
            className="grid grid-cols-1 gap-4 @[27rem]:grid-cols-2 @[40rem]:grid-cols-3 @[54rem]:grid-cols-4"
          >
            {items.map((item, i) => (
              <li
                key={item.url}
                data-photo-url={item.url}
                onDragOver={(e) => {
                  if (dragging === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== i) setDropTarget(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging !== null) move(dragging, i);
                  setDragging(null);
                  setDropTarget(null);
                }}
                className={cn(
                  // Narrow: thumbnail beside the controls; wider: a grid of cards.
                  "flex overflow-hidden rounded-2xl border bg-surface transition-[box-shadow,opacity,border-color] @[27rem]:flex-col",
                  i === 0 ? "border-brand-300" : "border-line",
                  dragging === i && "opacity-40",
                  dropTarget === i && dragging !== i && "border-brand-500 ring-3 ring-brand-100",
                )}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    setDragging(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", item.url);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  title={item.url}
                  className="relative min-h-28 w-32 shrink-0 cursor-grab bg-sunken active:cursor-grabbing @[27rem]:aspect-[4/3] @[27rem]:min-h-0 @[27rem]:w-auto"
                >
                  <Photo
                    src={item.url}
                    alt={item.caption || `Photo ${i + 1}`}
                    sizes="(min-width: 768px) 240px, 50vw"
                    className="pointer-events-none size-full"
                  />
                  <span
                    className={cn(
                      "absolute top-2 left-2 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm",
                      i === 0 ? "bg-brand-700 text-white" : "bg-white/90 text-ink tabular",
                    )}
                  >
                    {i === 0 ? "Cover" : i + 1}
                  </span>
                  <button
                    type="button"
                    data-control="remove"
                    onClick={() => remove(i)}
                    aria-label={`Remove ${label(i)}`}
                    title="Remove photo"
                    className="absolute top-1.5 right-1.5 inline-flex size-10 items-center justify-center rounded-full bg-white/90 text-ink-soft shadow-sm transition-colors hover:bg-white hover:text-clay-600 focus-visible:ring-3 focus-visible:ring-brand-100 focus-visible:outline-none"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
                  <Input
                    value={item.caption}
                    maxLength={200}
                    placeholder="Caption (optional)"
                    aria-label={`Caption for ${label(i)}`}
                    onChange={(e) =>
                      setItems(
                        items.map((it, j) => (j === i ? { ...it, caption: e.target.value } : it)),
                      )
                    }
                    className="h-10 text-base sm:text-sm"
                  />
                  <p className="truncate text-xs text-faint" title={item.url}>
                    {shortUrl(item.url)}
                  </p>
                  <div className="-mx-1 mt-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      data-control="grip"
                      onKeyDown={(e) => onGripKey(e, i)}
                      aria-label={`Reorder ${label(i)}. Use the arrow keys to move it.`}
                      title="Focus and use arrow keys to reorder"
                      className={cn(iconButton, "cursor-grab")}
                    >
                      <GripVertical />
                    </button>
                    <button
                      type="button"
                      data-control="earlier"
                      onClick={() => move(i, i - 1, "earlier")}
                      disabled={i === 0}
                      aria-label={`Move ${label(i)} earlier`}
                      title="Move earlier"
                      className={iconButton}
                    >
                      <ChevronLeft />
                    </button>
                    <button
                      type="button"
                      data-control="later"
                      onClick={() => move(i, i + 1, "later")}
                      disabled={i === count - 1}
                      aria-label={`Move ${label(i)} later`}
                      title="Move later"
                      className={iconButton}
                    >
                      <ChevronRight />
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        data-control="cover"
                        onClick={() => move(i, 0, "grip")}
                        aria-label={`Make ${label(i)} the cover`}
                        title="Make cover photo"
                        className={cn(iconButton, "ml-auto hover:text-brass-700")}
                      >
                        <Star />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
