"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { toggleSavedListing } from "@/server/actions/saved";

type SavedHomes = {
  signedIn: boolean;
  isSaved: (id: string) => boolean;
  toggle: (id: string) => void;
  pending: boolean;
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  const toggle = useCallback(
    (id: string) => {
      if (!signedIn) {
        router.push(`/sign-in?next=${encodeURIComponent(pathname)}&reason=save`);
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
          if (res.error === "unauthenticated")
            router.push(`/sign-in?next=${encodeURIComponent(pathname)}`);
        } else if (res.saved !== !wasSaved) {
          flip(res.saved);
        }
      });
    },
    [ids, signedIn, router, pathname],
  );

  const value = useMemo<SavedHomes>(
    () => ({ signedIn, isSaved: (id) => ids.has(id), toggle, pending }),
    [ids, signedIn, toggle, pending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSavedHomes(): SavedHomes {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSavedHomes must be used inside SavedHomesProvider");
  return ctx;
}
