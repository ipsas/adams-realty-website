"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSavedHomes } from "./saved-homes-provider";

export function SaveButton({
  listingId,
  variant = "overlay",
  className,
}: {
  listingId: string;
  variant?: "overlay" | "outline";
  className?: string;
}) {
  const { isSaved, toggle } = useSavedHomes();
  const saved = isSaved(listingId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved homes" : "Save home"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(listingId);
      }}
      className={cn(
        "group/save inline-flex items-center justify-center gap-2 transition-all active:scale-90",
        variant === "overlay" &&
          "size-10 rounded-full bg-white/90 text-ink shadow-sm backdrop-blur hover:scale-105 hover:bg-white",
        variant === "outline" &&
          "h-10 rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-sunken",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-[18px] transition-colors",
          saved ? "fill-clay-500 text-clay-500" : "text-ink group-hover/save:text-clay-500",
        )}
        strokeWidth={2}
      />
      {variant === "outline" && (saved ? "Saved" : "Save")}
    </button>
  );
}
