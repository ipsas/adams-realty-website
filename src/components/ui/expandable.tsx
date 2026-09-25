"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Expandable({
  children,
  collapsedHeight = "12rem",
}: {
  children: ReactNode;
  collapsedHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div
        className={cn("relative overflow-hidden", !open && "mask-b-from-60%")}
        style={open ? undefined : { maxHeight: collapsedHeight }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
      >
        {open ? "Show less" : "Read more"}
      </button>
    </div>
  );
}
