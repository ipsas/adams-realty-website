"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The listing's call-to-action bar below lg: the price and one button that brings up the
 * contact form (#contact). While any part of the form is on screen the bar slides away,
 * so it can't cover the form's own Send button or be mistaken for it. Tapping the button
 * scrolls the form into view and puts the cursor in Name. WP5's ListingActionBar replaces
 * it and keeps both rules.
 */
export function ListingCtaBar({ summary, label }: { summary: ReactNode; label: string }) {
  const [formOnScreen, setFormOnScreen] = useState(false);

  useEffect(() => {
    const form = document.getElementById("contact");
    if (!form || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setFormOnScreen(entry.isIntersecting));
    io.observe(form);
    return () => io.disconnect();
  }, []);

  return (
    <div
      data-cta-bar
      data-state={formOnScreen ? "hidden" : "visible"}
      aria-hidden={formOnScreen || undefined}
      inert={formOnScreen}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur transition-transform duration-200 motion-reduce:transition-none lg:hidden",
        formOnScreen && "translate-y-full",
      )}
    >
      <div>{summary}</div>
      <a
        href="#contact"
        onClick={(e) => {
          const form = document.getElementById("contact");
          if (!form) return;
          e.preventDefault();
          const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          form.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
          document.getElementById("c-name")?.focus({ preventScroll: true });
        }}
        className="flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
      >
        {label}
      </a>
    </div>
  );
}
