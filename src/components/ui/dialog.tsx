"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Native <dialog> wrapper: focus trapping, Escape and backdrop come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-surface p-0 text-ink shadow-pop backdrop:animate-fade-in open:flex open:animate-rise open:flex-col",
        className,
      )}
    >
      {title !== undefined && (
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-full p-2 text-muted hover:bg-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>
      )}
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="border-t border-line px-6 py-4">{footer}</footer>}
    </dialog>
  );
}
