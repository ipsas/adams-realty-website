"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { type ThemePref, applyTheme, writeThemePref } from "@/lib/theme";
import { useThemePref } from "./use-theme";

type Option = { value: ThemePref; icon: LucideIcon; list: string; segmented: string };

const OPTIONS: readonly Option[] = [
  { value: "system", icon: Monitor, list: "Match my device", segmented: "Auto" },
  { value: "light", icon: Sun, list: "Light", segmented: "Light" },
  { value: "dark", icon: Moon, list: "Dark", segmented: "Dark" },
];

/** Saves the choice and paints it now; ThemeSync also follows the write (and other tabs). */
function choose(pref: ThemePref) {
  writeThemePref(pref);
  applyTheme(pref);
}

/**
 * The appearance choice: Match my device (the default) / Light / Dark, as a native radio
 * group in a fieldset, so it gets radio semantics, checked state and arrow-key selection for
 * free. Each radio is stretched over its whole option, which makes the option the tap target
 * (44px on coarse pointers) and puts the global focus ring around it.
 *
 * - `list`: rows with a check mark, the chosen one filled, for the header's appearance menu.
 * - `segmented`: Auto / Light / Dark in one row, for the phone menu.
 *
 * Announces nothing (no aria-live, no role=status): /homes keeps one polite live region.
 */
export function AppearanceControl({
  variant,
  className,
}: {
  variant: "segmented" | "list";
  className?: string;
}) {
  const pref = useThemePref();
  const name = useId();
  const segmented = variant === "segmented";

  return (
    <fieldset className={cn("min-w-0", className)} data-appearance={variant}>
      <legend
        className={cn(
          "text-xs font-semibold tracking-[0.12em] text-muted uppercase",
          segmented ? "mb-3" : "px-3 pt-2 pb-1.5",
        )}
      >
        Appearance
      </legend>
      <div
        className={cn(
          segmented ? "grid max-w-md grid-cols-3 gap-1 rounded-xl bg-sunken p-1" : "flex flex-col",
        )}
      >
        {OPTIONS.map(({ value, icon: Icon, list, segmented: short }) => (
          <label
            key={value}
            className={cn(
              "group relative flex cursor-pointer items-center text-sm transition-colors",
              segmented
                ? "h-10 justify-center gap-1.5 rounded-lg font-medium text-muted hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-card pointer-coarse:h-11"
                : "gap-2.5 rounded-lg px-3 py-2.5 text-ink-soft hover:bg-sunken hover:text-ink has-checked:bg-sunken has-checked:font-medium has-checked:text-ink pointer-coarse:min-h-11",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={pref === value}
              onChange={() => choose(value)}
              className={cn(
                "absolute inset-0 size-full cursor-pointer appearance-none rounded-lg",
                segmented && "focus-visible:-outline-offset-2",
              )}
            />
            <Icon aria-hidden className="size-4 shrink-0" />
            {segmented ? (
              <span>
                {short}
                {value === "system" && <span className="sr-only"> (match my device)</span>}
              </span>
            ) : (
              <>
                <span>{list}</span>
                <Check
                  aria-hidden
                  className="invisible ml-auto size-4 shrink-0 text-brand-700 group-has-checked:visible"
                />
              </>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
