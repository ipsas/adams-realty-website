"use client";

import { useEffect } from "react";
import { countListingView } from "@/server/actions/views";

/** Listings already counted in this tab, so a dev-mode double effect or a re-render counts once. */
const counted = new Set<string>();

/** Counts a view of the listing page (Georgia MLS traffic statistics). Renders nothing. */
export function CountView({ listingId }: { listingId: string }) {
  useEffect(() => {
    if (counted.has(listingId)) return;
    counted.add(listingId);
    void countListingView(listingId).catch(() => counted.delete(listingId));
  }, [listingId]);
  return null;
}
