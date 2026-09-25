"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { Popover } from "../ui/popover";
import { AppearanceControl } from "./appearance-control";

/**
 * The header's appearance menu (wide screens; phones use the menu's segmented control).
 * The icon is chosen by CSS (`dark:`), so it is right before hydration. Picking an option
 * keeps the menu open; Escape, an outside tap and focus return come from Popover.
 */
export function ThemeMenuButton({
  transparent,
  className,
}: {
  /** Over the home hero photo: white icon, like the header's other transparent controls. */
  transparent: boolean;
  className?: string;
}) {
  return (
    <Popover
      align="end"
      unstyled
      showChevron={false}
      fixedOnMobile={false}
      className={className}
      panelClassName="min-w-60 p-2"
      triggerClassName={cn(
        "flex size-10 items-center justify-center rounded-full transition-colors pointer-coarse:size-11",
        transparent
          ? "text-white hover:bg-white/10"
          : "text-ink-soft hover:bg-sunken hover:text-ink",
      )}
      label={
        <>
          <Sun aria-hidden className="size-[18px] dark:hidden" />
          <Moon aria-hidden className="hidden size-[18px] dark:block" />
          <span className="sr-only">Appearance</span>
        </>
      }
    >
      <AppearanceControl variant="list" />
    </Popover>
  );
}
