"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  isListUrl,
  lastList,
  markReturn,
  readStamp,
  rememberList,
  takeReturn,
  withStamp,
  type ReturnScope,
} from "@/lib/return-nav";
import { lastSearchHref } from "@/lib/search/recent";

type Target = { href: string; back: boolean };

/**
 * Where this history entry's link leads. The first visit takes the list page's mark and
 * stamps the entry, so later reads (a reload, Back/Forward to it) find the stamp instead.
 */
function resolveTarget(scope: ReturnScope): Target | null {
  const stamped = readStamp(scope, window.history.state);
  if (stamped) return { href: stamped, back: true };
  const from = takeReturn(scope, window.location.pathname);
  // A new tab opened from the list has nothing to go back to.
  if (from && window.history.length > 1) {
    window.history.replaceState(withStamp(scope, from, window.history.state), "");
    return { href: from, back: true };
  }
  const last = scope === "search" ? lastSearchHref() : lastList(scope);
  return last ? { href: last, back: false } : null;
}

// The resolved targets, per scope and page, as a tiny store (resolving has side effects,
// so it happens in an effect, and the link re-renders when it's done).
const targets = new Map<string, Target | null>();
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function publish(id: string, target: Target | null) {
  targets.set(id, target);
  listeners.forEach((cb) => cb());
}

/**
 * "‹ Back to results", "All leads", "Back to listings": the way back from a detail page to
 * its list. Opened from that list in this tab, it acts like Back, so the list returns as it
 * was (scroll, tab, filters, the tapped card). Opened any other way (a shared link, a
 * bookmark, another page), it links to the last list of that kind, else to `fallback`.
 * The server renders the fallback; the browser picks the real target after hydration.
 */
export function ReturnLink({
  scope,
  fallback,
  children,
  className,
}: {
  scope: ReturnScope;
  fallback: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const id = `${scope} ${pathname}`;
  const target = useSyncExternalStore(
    subscribe,
    () => targets.get(id) ?? null,
    () => null,
  );
  // Per page: a client navigation to another detail page can keep this mounted.
  useEffect(() => publish(id, resolveTarget(scope)), [id, scope]);

  return (
    <Link
      href={target?.href ?? fallback}
      data-return-link={scope}
      data-return-mode={target ? (target.back ? "back" : "last") : "fallback"}
      onClick={(e) => {
        if (!target?.back) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        router.back();
      }}
      className={cn(
        "-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-ink-soft transition-colors hover:text-ink",
        className,
      )}
    >
      <ChevronLeft className="size-4 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}

/**
 * On a dashboard list page: remembers the list's URL (for ReturnLink's fallback) and marks
 * the hand-off when one of its detail links is followed, so the detail page's link acts
 * like Back. /homes does the same in search-view.tsx, with its scroll restoration.
 */
export function ReturnSource({ scope }: { scope: Exclude<ReturnScope, "search"> }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    rememberList(scope, here);
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !isListUrl(scope, here)) return;
      markReturn(scope, here, url.pathname);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [scope, here]);

  return null;
}
