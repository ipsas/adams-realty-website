"use client";

import { useEffect, type ReactNode } from "react";
import { FormMessage } from "@/components/ui/form";

/** "Profile created" after the redirect from the new-agent form; drops `?created` so a reload doesn't repeat it. */
export function CreatedNotice({ children }: { children: ReactNode }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("created")) return;
    url.searchParams.delete("created");
    window.history.replaceState(null, "", url);
  }, []);
  return <FormMessage tone="success">{children}</FormMessage>;
}
