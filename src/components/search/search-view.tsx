"use client";

import { List, Map as MapIcon, SearchX } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ListingCard } from "@/components/listings/listing-card";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { ListingCardData } from "@/lib/listings/card";
import { MlsAttribution } from "@/components/content/mls-attribution";
import { site } from "@/config/site";
import {
  countActiveFilters,
  describeCriteria,
  serializeCriteria,
  SORTS,
  sortLabel,
  type SearchCriteria,
  type SortValue,
} from "@/lib/search/params";
import { recordSearch } from "@/lib/search/recent";
import type { MapPin } from "@/lib/search/service";
import { FilterBar } from "./filter-bar";
import { Pagination } from "./pagination";
import { SaveSearchButton } from "./save-search-button";
import { currentView, useSearchNav } from "./use-search-nav";

// MapLibre touches `window` at import time, so the map only renders on the client.
const SearchMap = dynamic(() => import("./search-map"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-sunken" />,
});

export function SearchView({
  criteria,
  items,
  total,
  pageCount,
  pins,
  maxPins,
  signedIn,
}: {
  criteria: SearchCriteria;
  items: ListingCardData[];
  total: number;
  pageCount: number;
  pins: MapPin[];
  maxPins: number;
  signedIn: boolean;
}) {
  const { update, isPending } = useSearchNav(criteria);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [searchAsMove, setSearchAsMove] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const listRef = useRef<HTMLDivElement>(null);

  // Remember this search on the device (recents, tab bar, relaunch cookie).
  const serialized = serializeCriteria(criteria).toString();
  useEffect(() => {
    recordSearch(criteria, currentView());
    // `serialized` captures every criteria change; the object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  // Re-fit the map only when the "what" changes, not the "where".
  const fitKey = JSON.stringify({
    ...criteria,
    bounds: undefined,
    page: undefined,
    sort: undefined,
  });

  const noun =
    criteria.mode === "rent"
      ? "rentals"
      : criteria.mode === "sold"
        ? "sold homes"
        : "homes for sale";

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <FilterBar criteria={criteria} update={update} signedIn={signedIn} />

      <div className="relative flex min-h-0 flex-1">
        {/* Results list. Below lg, the bottom padding clears the floating List/Map toggle
            (bottom-6, 44px tall on touch) so the Georgia MLS notice at the end stays readable. */}
        <div
          ref={listRef}
          data-results-list
          className={cn(
            "w-full overflow-y-auto max-lg:pb-24 lg:w-[56%] xl:w-[52%] 2xl:w-[48%]",
            mobileView === "map" && "max-lg:hidden",
          )}
        >
          <div className="px-4 pt-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display-tight text-2xl font-medium text-ink">
                  {noun.charAt(0).toUpperCase() + noun.slice(1)} in{" "}
                  {criteria.q ?? (criteria.bounds ? "this area" : site.coverage.name)}
                </h1>
                <p className="mt-0.5 text-sm text-muted" aria-live="polite">
                  {formatNumber(total)} {total === 1 ? "result" : "results"}
                  {countActiveFilters(criteria) > 0 && ` · ${describeCriteria(criteria)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted">
                  Sort
                  <Select
                    aria-label="Sort results"
                    className="h-9 w-auto rounded-full py-0 text-sm"
                    value={criteria.sort}
                    onChange={(e) => update({ sort: e.target.value as SortValue })}
                  >
                    {SORTS.map((s) => (
                      <option key={s} value={s}>
                        {sortLabel(s, criteria.mode)}
                      </option>
                    ))}
                  </Select>
                </label>
                <SaveSearchButton criteria={criteria} signedIn={signedIn} />
              </div>
            </div>
          </div>

          <div
            className={cn(
              "px-4 pt-5 pb-4 transition-opacity sm:px-6",
              isPending && "pointer-events-none opacity-50",
            )}
          >
            {items.length > 0 ? (
              <div className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2">
                {items.map((l, i) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    priority={i < 4}
                    highlighted={highlighted === l.id}
                    onHover={setHighlighted}
                    sizes="(min-width: 1536px) 22vw, (min-width: 1024px) 26vw, (min-width: 640px) 45vw, 92vw"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                hasBounds={!!criteria.bounds}
                onZoomOut={() => update({ bounds: undefined })}
                onReset={() =>
                  update({
                    mode: criteria.mode,
                    q: criteria.q,
                    bounds: undefined,
                    minPrice: undefined,
                    maxPrice: undefined,
                    beds: undefined,
                    baths: undefined,
                    types: undefined,
                  })
                }
              />
            )}
            <Pagination
              page={criteria.page}
              pageCount={pageCount}
              onPage={(page) => {
                update({ page });
                listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
            <div className="space-y-2 px-4 pb-6 text-xs text-muted">
              <MlsAttribution className="justify-center" />
              <p className="text-center" data-mls-disclaimer>
                Listing data comes from {site.mls.name} and is refreshed regularly. Information
                deemed reliable but not guaranteed.
              </p>
            </div>
          </div>
        </div>

        {/* Map */}
        <div
          className={cn(
            "relative flex-1 border-l border-line",
            mobileView === "list" && "max-lg:hidden",
          )}
        >
          <SearchMap
            pins={pins}
            bounds={criteria.bounds}
            fitKey={fitKey}
            highlightedId={highlighted}
            onHover={setHighlighted}
            onUserMove={(bounds) => {
              if (searchAsMove) update({ bounds }, { replace: true });
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-surface/95 px-4 py-2 text-sm shadow-card backdrop-blur">
              <Checkbox
                label="Search as I move the map"
                checked={searchAsMove}
                onChange={(e) => setSearchAsMove(e.target.checked)}
              />
              {criteria.bounds && (
                <button
                  type="button"
                  className="font-medium text-brand-700 hover:underline"
                  onClick={() => update({ bounds: undefined })}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          {pins.length >= maxPins && (
            <p className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-shade/80 px-4 py-2 text-xs text-white shadow">
              Showing the first {maxPins} of {formatNumber(total)} — zoom in to see more
            </p>
          )}
        </div>

        {/* Mobile list/map toggle */}
        <Button
          variant="primary"
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 shadow-pop lg:hidden"
          onClick={() => setMobileView((v) => (v === "list" ? "map" : "list"))}
        >
          {mobileView === "list" ? <MapIcon /> : <List />}
          {mobileView === "list" ? "Map" : "List"}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  hasBounds,
  onZoomOut,
  onReset,
}: {
  hasBounds: boolean;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-16 text-center">
      <SearchX className="size-10 text-faint" strokeWidth={1.5} />
      <h2 className="mt-4 text-lg font-semibold text-ink">No homes match — yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Try widening your filters{hasBounds ? " or searching a bigger area" : ""}. Or save this
        search and we&apos;ll email you the moment something fits.
      </p>
      <div className="mt-6 flex gap-2">
        {hasBounds && (
          <Button variant="secondary" onClick={onZoomOut}>
            Search the whole area
          </Button>
        )}
        <Button variant="ghost" onClick={onReset}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}
