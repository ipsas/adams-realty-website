"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal accessible popover: button + floating panel. Closes on outside
 * click, Escape (returning focus to the trigger) and navigation.
 *
 * With `fixedOnMobile` (default), below lg the panel floats as a bottom card over a scrim.
 * The scrim closes the popover on pointerdown and swallows the rest of that tap, so the
 * dismissing tap never reaches a link or card underneath.
 */
export function Popover({
  label,
  children,
  active = false,
  align = "start",
  className,
  panelClassName,
  triggerClassName,
  unstyled = false,
  showChevron = true,
  fixedOnMobile = true,
}: {
  label: ReactNode;
  children: ReactNode;
  active?: boolean;
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  /** Extra classes for the trigger button (merged after the defaults). */
  triggerClassName?: string;
  /** Drop the default pill styling of the trigger; style it with `triggerClassName`. */
  unstyled?: boolean;
  showChevron?: boolean;
  fixedOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Keeps an invisible scrim up after a dismissing pointerdown until its click lands on it.
  const [swallowing, setSwallowing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Safety net: if the swallowed tap never produces a click (drag, long press), drop the scrim.
  useEffect(() => {
    if (!swallowing) return;
    const t = setTimeout(() => setSwallowing(false), 700);
    return () => clearTimeout(t);
  }, [swallowing]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          !unstyled && [
            "flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
            active
              ? "border-brand-700 bg-brand-50 text-brand-800"
              : "border-line-strong bg-surface text-ink-soft hover:border-faint hover:text-ink",
            open && "ring-3 ring-brand-100",
          ],
          triggerClassName,
        )}
      >
        {label}
        {showChevron && (
          <ChevronDown
            className={cn("size-4 opacity-60 transition-transform", open && "rotate-180")}
          />
        )}
      </button>
      {fixedOnMobile && (open || swallowing) && (
        <div
          aria-hidden
          data-popover-scrim
          className={cn(
            "fixed inset-0 z-[45] touch-none lg:hidden",
            open ? "animate-fade-in bg-ink/30" : "bg-transparent",
          )}
          onPointerDown={(e) => {
            e.preventDefault();
            setOpen(false);
            setSwallowing(true);
          }}
          onClick={() => setSwallowing(false)}
          onPointerCancel={() => setSwallowing(false)}
        />
      )}
      {open && (
        <div
          id={id}
          role="dialog"
          className={cn(
            "absolute top-full z-40 mt-2 min-w-72 animate-rise rounded-2xl border border-line bg-surface p-5 shadow-pop",
            align === "end" ? "right-0" : "left-0",
            // On narrow screens, float as a bottom card (above the tab bar and home indicator)
            // so scrolling toolbars can't clip it.
            fixedOnMobile &&
              "max-lg:fixed max-lg:top-auto max-lg:right-[max(0.75rem,var(--sai-right))] max-lg:bottom-safe-3 max-lg:left-[max(0.75rem,var(--sai-left))] max-lg:z-[45] max-lg:max-h-[calc(100dvh-var(--sai-top)-var(--sai-bottom)-1.5rem)] max-lg:min-w-0 max-lg:overflow-y-auto max-lg:overscroll-contain",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
