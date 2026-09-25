"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type TocItem = { id: string; title: string };

/** Sections count as "current" once their top passes this line (below the sticky header). */
const ACTIVE_LINE_PX = 128;

/**
 * Desktop "On this page" rail for long documents. Highlights the section
 * being read; the links are plain anchors, so it works before hydration.
 */
export function TocNav({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const ids = items.map((i) => i.id).join(" ");

  useEffect(() => {
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = sections[0]?.id;
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= ACTIVE_LINE_PX) current = el.id;
      }
      // Short closing sections never reach the line; at the very bottom, the last one is current.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && sections.length) current = sections[sections.length - 1].id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);

  return (
    <nav aria-label="On this page">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">On this page</p>
      <ol className="mt-4 border-l border-line">
        {items.map((item) => {
          const current = item.id === active;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "location" : undefined}
                className={cn(
                  "-ml-px block border-l-2 py-1.5 pl-4 text-sm leading-snug transition-colors",
                  current
                    ? "border-brand-600 font-medium text-ink"
                    : "border-transparent text-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {item.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
