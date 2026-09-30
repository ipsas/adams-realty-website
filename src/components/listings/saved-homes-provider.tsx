"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { toast } from "@/components/ui/toast";
import { rememberSaveIntent, takeSaveIntent } from "@/lib/save-intent";
import { ensureSaved } from "@/server/actions/save-intent";
import { toggleSavedListing } from "@/server/actions/saved";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where to return after signing in from a heart (F08): this page with its whole query
 * (so the search survives) plus `save=<id>`, which saves the home once signed in.
 */
export function saveIntentNext(pathAndQuery: string, listingId: string): string {
  const url = new URL(pathAndQuery, "http://x");
  url.searchParams.set("save", listingId);
  return url.pathname + url.search;
}

/** Drops `save=` from the address bar without a server request (Next syncs its router). */
function dropSaveParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("save")) return;
  url.searchParams.delete("save");
  const state: Record<string, unknown> = { ...(window.history.state ?? {}) };
  // Without its own keys, Next's replaceState patch updates useSearchParams (see replaceViewParam).
  delete state.__NA;
  delete state.__PRIVATE_NEXTJS_INTERNALS_TREE;
  window.history.replaceState(state, "", url.pathname + url.search + url.hash);
}

type SavedHomes = {
  signedIn: boolean;
  isSaved: (id: string) => boolean;
  toggle: (id: string) => void;
  pending: boolean;
  /** Number of saved homes (tab bar badge). */
  count: number;
  /**
   * Client-only override with no server call (pending removal / Undo, post-sign-in save).
   * The next server reconcile (fresh `initialIds`) wins.
   */
  setLocal: (id: string, saved: boolean) => void;
};

const Ctx = createContext<SavedHomes | null>(null);

/**
 * Holds the signed-in user's saved listing IDs so every heart button on the
 * page updates instantly (optimistic), then reconciles with the server.
 */
export function SavedHomesProvider({
  initialIds,
  signedIn,
  children,
}: {
  initialIds: string[];
  signedIn: boolean;
  children: ReactNode;
}) {
  const [ids, setIds] = useState(() => new Set(initialIds));
  // The root layout stays mounted across client navigations (e.g. signing in),
  // so adopt fresh server IDs whenever they change instead of only on mount.
  const serverKey = initialIds.join(",");
  const [lastServerKey, setLastServerKey] = useState(serverKey);
  if (serverKey !== lastServerKey) {
    setLastServerKey(serverKey);
    setIds(new Set(initialIds));
  }
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const toggle = useCallback(
    (id: string) => {
      if (!signedIn) {
        const next = saveIntentNext(window.location.pathname + window.location.search, id);
        rememberSaveIntent(id);
        router.push(`/sign-in?next=${encodeURIComponent(next)}&reason=save`);
        return;
      }
      const wasSaved = ids.has(id);
      const flip = (saved: boolean) =>
        setIds((prev) => {
          const next = new Set(prev);
          if (saved) next.add(id);
          else next.delete(id);
          return next;
        });
      flip(!wasSaved);
      startTransition(async () => {
        const res = await toggleSavedListing(id);
        if (!res.ok) {
          flip(wasSaved);
          if (res.error === "unauthenticated") {
            const next = saveIntentNext(window.location.pathname + window.location.search, id);
            rememberSaveIntent(id);
            router.push(`/sign-in?next=${encodeURIComponent(next)}&reason=save`);
          }
        } else if (res.saved !== !wasSaved) {
          flip(res.saved);
        }
      });
    },
    [ids, signedIn, router],
  );

  const setLocal = useCallback((id: string, saved: boolean) => {
    setIds((prev) => {
      if (prev.has(id) === saved) return prev;
      const next = new Set(prev);
      if (saved) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Signed in with a pending heart from before sign-in (?save=<id>): save it, once, and only
  // when this tab's own heart tap asked for it (a `save=` in a link someone sent saves nothing).
  const handledSave = useRef<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    const id = new URLSearchParams(window.location.search).get("save");
    if (!id) return;
    dropSaveParam();
    if (handledSave.current === id || !UUID.test(id)) return;
    handledSave.current = id;
    if (!takeSaveIntent(id)) return;
    void ensureSaved(id).then((res) => {
      if (!res.ok) return;
      setLocal(id, true);
      toast("Saved to your homes", {
        action: { label: "View", onClick: () => router.push("/saved") },
      });
    });
    // The pathname changes when sign-in lands on the page; signedIn when the layout catches up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, pathname]);

  const value = useMemo<SavedHomes>(
    () => ({
      signedIn,
      isSaved: (id) => ids.has(id),
      toggle,
      pending,
      count: ids.size,
      setLocal,
    }),
    [ids, signedIn, toggle, pending, setLocal],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSavedHomes(): SavedHomes {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSavedHomes must be used inside SavedHomesProvider");
  return ctx;
}
