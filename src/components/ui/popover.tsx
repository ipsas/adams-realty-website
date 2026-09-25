"use client";

import { ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal accessible popover: button + floating panel. Closes on outside
 * click, Escape (returning focus to the trigger) and navigation.
 */
export function Popover({
  label,
  children,
  active = false,
  align = "start",
  className,
  panelClassName,
  showChevron = true,
  fixedOnMobile = true,
}: {
  label: ReactNode;
  children: ReactNode;
  active?: boolean;
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
  showChevron?: boolean;
  fixedOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
          active
            ? "border-brand-700 bg-brand-50 text-brand-800"
            : "border-line-strong bg-surface text-ink-soft hover:border-faint hover:text-ink",
          open && "ring-3 ring-brand-100",
        )}
      >
        {label}
        {showChevron && (
          <ChevronDown
            className={cn("size-4 opacity-60 transition-transform", open && "rotate-180")}
          />
        )}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          className={cn(
            "absolute top-full z-40 mt-2 min-w-72 animate-rise rounded-2xl border border-line bg-surface p-5 shadow-pop",
            align === "end" ? "right-0" : "left-0",
            // On narrow screens, float as a bottom sheet so scrolling toolbars can't clip it.
            fixedOnMobile &&
              "max-lg:fixed max-lg:inset-x-3 max-lg:top-auto max-lg:bottom-3 max-lg:min-w-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
