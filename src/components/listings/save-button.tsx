"use client";

import { Heart } from "lucide-react";
import { createContext, useContext } from "react";
import { cn } from "@/lib/cn";
import { useSavedHomes } from "./saved-homes-provider";

/**
 * When provided, pressing an already-saved heart calls this instead of unsaving right away.
 * /saved uses it for pending removal with an Undo toast.
 */
export const SaveIntercept = createContext<((listingId: string) => void) | null>(null);

export type SaveButtonVariant = "overlay" | "outline" | "plain";

/**
 * Heart toggle for a listing.
 * - overlay: frosted circle on photos (44px on touch).
 * - outline: labelled pill ("Save"/"Saved").
 * - plain: 44px transparent circle with a 20px heart, for bars, rows and strip cards.
 */
export function SaveButton({
  listingId,
  variant = "overlay",
  className,
}: {
  listingId: string;
  variant?: SaveButtonVariant;
  className?: string;
}) {
  const { isSaved, toggle } = useSavedHomes();
  const intercept = useContext(SaveIntercept);
  const saved = isSaved(listingId);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved homes" : "Save home"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (saved && intercept) intercept(listingId);
        else toggle(listingId);
      }}
      className={cn(
        "group/save inline-flex items-center justify-center gap-2 transition-all active:scale-90",
        variant === "overlay" &&
          "size-10 rounded-full bg-surface/90 text-ink shadow-sm backdrop-blur hover:scale-105 hover:bg-surface pointer-coarse:size-11",
        variant === "outline" &&
          "h-10 rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-sunken pointer-coarse:h-11",
        variant === "plain" &&
          "size-11 shrink-0 rounded-full bg-transparent text-ink hover:bg-ink/5",
        className,
      )}
    >
      <Heart
        className={cn(
          "transition-colors",
          variant === "plain" ? "size-5" : "size-[18px]",
          saved ? "fill-current text-clay-500" : "text-ink group-hover/save:text-clay-500",
        )}
        strokeWidth={2}
      />
      {variant === "outline" && (saved ? "Saved" : "Save")}
    </button>
  );
}
