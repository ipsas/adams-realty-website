"use client";

import { ArrowLeft, BellPlus, Check, List, Map as MapIcon, SearchX } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
  type UIEvent,
} from "react";
import { ListingCard } from "@/components/listings/listing-card";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { ListingCardData } from "@/lib/listings/card";
import { MlsAttribution } from "@/components/content/mls-attribution";
import { site } from "@/config/site";
import {
  type Bounds,
  clearedFilters,
  countActiveFilters,
  describeCriteria,
  listingNoun,
  noResultsCopy,
  parseViewParam,
  searchHref,
  serializeCriteria,
  SORTS,
  sortLabel,
  type SearchCriteria,
  type SearchMode,
  type SortValue,
} from "@/lib/search/params";
import { markReturn } from "@/lib/return-nav";
import { recordSearch, setLastSearchView } from "@/lib/search/recent";
import { listingSlugOf, placeKey, readPlace, writePlace } from "@/lib/search/restore";
import type { NearbyTown } from "@/lib/search/place";
import type { MapPin } from "@/lib/search/service";
import { FilterBar } from "./filter-bar";
import { Pagination } from "./pagination";
import { SaveSearchButton, useSaveSearch, type SaveSearchState } from "./save-search-button";
import { buildSearchHref, currentView, useSearchNav } from "./use-search-nav";

/** Cards whose photo loads with the page (the first rows; site review #10). */
const EAGER_CARDS = 4;
/** How close (px) a later card must come to the screen before its photo loads. */
const CARD_PHOTOS_NEAR_PX = 400;

/** What a search with no results offers (computed on the server; site review #5). */
export type EmptyHelp = {
  /** Where the searched place is, so the map goes there; null when it's unknown. */
  placeBounds: Bounds | null;
  /** The nearest towns with homes for this search. */
  nearby: NearbyTown[];
  /**
   * For a place (a town, lake or map area): the other modes with listings there, same
   * property type, other filters dropped ("Homes for sale in Carnesville" for rentals).
   */
  elsewhere?: { mode: SearchMode; count: number }[];
};

// MapLibre touches `window` at import time, so the map only renders on the client.
const SearchMap = dynamic(() => import("./search-map"), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-sunken" />,
});

export function SearchView({
  criteria,
  heading,
  place,
  from,
  items,
  total,
  pageCount,
  pins,
  maxPins,
  signedIn,
  emptyHelp,
  mlsDisclaimer,
}: {
  criteria: SearchCriteria;
  /** "Homes for sale in Hartwell", "Homes near Lake Hartwell", "Homes in this map area"… */
  heading: string;
  /** The place searched as the heading names it ("Hartwell", "Lake Hartwell"), if any. */
  place?: string;
  /** The town a moved map came from ("Back to Royston"). */
  from?: string;
  items: ListingCardData[];
  total: number;
  pageCount: number;
  pins: MapPin[];
  maxPins: number;
  signedIn: boolean;
  emptyHelp?: EmptyHelp;
  /** Georgia MLS's IDX disclaimer, computed on the server (`mlsDisclaimer`). */
  mlsDisclaimer: string;
}) {
  const { update, setView, isPending } = useSearchNav(criteria);
  const save = useSaveSearch(signedIn);
  const router = useRouter();
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [searchAsMove, setSearchAsMove] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // List or map (below lg) lives in the URL as the sheet position (`view=map`), so Back,
  // reload and the last search bring it back. setView() rewrites it without a request.
  const searchParams = useSearchParams();
  const mobileView: "list" | "map" =
    parseViewParam(searchParams.getAll("view")) === "map" ? "map" : "list";
  const query = searchParams.toString();
  const here = query ? `/homes?${query}` : "/homes";

  const restore = usePlaceRestoration({ here, listRef, mobileView, setView });

  // A tap on a card (or its heart) or on the map's preview remembers the card and the list's
  // place, and marks the hand-off so the listing's "Back to results" acts like Back.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const anchor = target.closest?.("a[href]") as HTMLAnchorElement | null;
    const card = target.closest?.("article");
    const slug =
      listingSlugOf(anchor?.href) ??
      listingSlugOf(card?.querySelector<HTMLAnchorElement>("a[href^='/homes/']")?.href);
    if (!slug) return;
    restore.remember(slug);
    const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    if (!anchor || !plain || listingSlugOf(anchor.href) !== slug) return;
    markReturn("search", here, `/homes/${slug}`);
    // The map's preview is plain DOM: open it with the router, like the cards, so Back
    // returns to this page as it was instead of loading it again.
    if (anchor.closest(".maplibregl-popup")) {
      e.preventDefault();
      router.push(`/homes/${slug}`);
    }
  };

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

  // Moving the map drops the town and searches every home in view (site review #5); the
  // town is kept as `from`, for "Back to Royston".
  const backToTown = () => update({ q: from, bounds: undefined });

  // IDX: Georgia MLS's credit and disclaimer, and the brokerage's name and license.
  const notice = (
    <>
      <MlsAttribution className="justify-center" />
      <p className="text-center" data-mls-disclaimer>
        {mlsDisclaimer}
      </p>
      {site.brokerLicense && (
        <p className="text-center">
          {site.name} · GREC firm license {site.brokerLicense}
        </p>
      )}
    </>
  );

  return (
    // Fills the viewport under the header.
    <div className="flex h-[calc(100dvh-4rem)] flex-col" onClickCapture={onClickCapture}>
      <FilterBar criteria={criteria} update={update} signedIn={signedIn} />

      <div className="relative flex min-h-0 flex-1">
        {/* Results list. Below lg, the bottom padding clears the floating List/Map toggle
            (bottom-6, 44px tall on touch) so the Georgia MLS notice at the end stays readable. */}
        <div
          ref={listRef}
          data-results-list
          onScroll={restore.onScroll}
          className={cn(
            "w-full overflow-y-auto max-lg:pb-24 lg:w-[56%] xl:w-[52%] 2xl:w-[48%]",
            mobileView === "map" && "max-lg:hidden",
          )}
        >
          <div className="px-4 pt-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display-tight text-2xl font-medium text-ink">{heading}</h1>
                {from && (
                  <Link
                    href={buildSearchHref(criteria, { q: from, bounds: undefined })}
                    replace
                    scroll={false}
                    onClick={(e) => {
                      e.preventDefault();
                      backToTown();
                    }}
                    className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 hover:underline pointer-fine:min-h-0"
                    data-testid="back-to-town"
                  >
                    <ArrowLeft className="size-4" /> Back to {from}
                  </Link>
                )}
                <p className="mt-0.5 text-sm text-muted" aria-live="polite">
                  {formatNumber(total)} {total === 1 ? "result" : "results"}
                  {countActiveFilters(criteria) > 0 && ` · ${describeCriteria(criteria)}`}
                </p>
              </div>
              {/* On a phone the row takes the full width and the sort menu shrinks to what's
                  left (its longest label, "Acreage (most first)", would push Save search off
                  the screen); from sm up it sizes to its label. */}
              <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted sm:flex-none">
                  Sort
                  <Select
                    aria-label="Sort results"
                    className="h-9 w-full min-w-0 rounded-full py-0 text-sm sm:w-auto"
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
                <SaveSearchButton criteria={criteria} save={save} />
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
                    priority={i < EAGER_CARDS}
                    // Below the first rows, a photo waits until its card is near the screen:
                    // on a slow signal the browser's own lazy loading reaches ~2,500 px ahead.
                    photoNearPx={i < EAGER_CARDS ? undefined : CARD_PHOTOS_NEAR_PX}
                    highlighted={highlighted === l.id}
                    onHover={setHighlighted}
                    sizes="(min-width: 1536px) 22vw, (min-width: 1024px) 26vw, (min-width: 640px) 45vw, 92vw"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                criteria={criteria}
                place={place}
                from={from}
                help={emptyHelp}
                save={save}
                onBackToTown={backToTown}
                onZoomOut={() => update({ bounds: undefined })}
                onClearFilters={() => update(clearedFilters())}
              />
            )}
            <Pagination
              page={criteria.page}
              pageCount={pageCount}
              onPage={(page) => {
                update({ page }, { push: true });
                listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
            <div className="space-y-2 px-4 pb-6 text-xs text-muted">{notice}</div>
          </div>
        </div>

        {/* Map */}
        <div
          className={cn(
            "flex flex-1 flex-col border-l border-line",
            mobileView === "list" && "max-lg:hidden",
          )}
        >
          <div className="relative min-h-0 flex-1">
            <SearchMap
              pins={pins}
              bounds={criteria.bounds}
              placeBounds={emptyHelp?.placeBounds ?? undefined}
              fitKey={fitKey}
              highlightedId={highlighted}
              onHover={setHighlighted}
              onUserMove={(bounds) => {
                if (!searchAsMove) return;
                // The town gives way to the map: every home in view, with a way back.
                if (criteria.q) update({ bounds, q: undefined }, { from: place ?? criteria.q });
                else update({ bounds });
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
                    onClick={() => (from ? backToTown() : update({ bounds: undefined }))}
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
          {/* Below lg the map view hides the list, so the notice shows under the map; the
              bottom padding clears the floating List/Map toggle. */}
          <div className="space-y-2 px-4 pt-3 pb-24 text-xs text-muted lg:hidden">{notice}</div>
        </div>

        {/* Mobile list/map toggle */}
        <Button
          variant="primary"
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full px-5 shadow-pop lg:hidden"
          onClick={() => {
            const next = mobileView === "list" ? "map" : null;
            setView(next);
            setLastSearchView(next);
          }}
        >
          {mobileView === "list" ? <MapIcon /> : <List />}
          {mobileView === "list" ? "Map" : "List"}
        </Button>
      </div>
    </div>
  );
}

type Target = { scrollTop: number; slug: string | null };

/**
 * Puts the results list back where the buyer left it (F13): on Back, after a reload, and
 * when "Back to results" links here. The place is saved when this search goes away (a card,
 * the heart's sign-in, another search, a reload or the tab hiding) and restored when it
 * comes back, within 30 minutes. The card they tapped is outlined for a moment and focused,
 * so keyboard users carry on from it too.
 */
function usePlaceRestoration({
  here,
  listRef,
  mobileView,
  setView,
}: {
  here: string;
  listRef: RefObject<HTMLDivElement | null>;
  mobileView: "list" | "map";
  setView: (view: "map" | null) => void;
}) {
  const scrollTop = useRef(0);
  const slug = useRef<string | null>(null);
  const view = useRef(mobileView);
  const hereRef = useRef(here);
  // A restore that waits for the list to show (it was hidden behind the map).
  const pending = useRef<Target | null>(null);
  // Only a different search counts as leaving, not the list/map switch.
  const key = placeKey(here);

  useLayoutEffect(() => {
    view.current = mobileView;
    hereRef.current = here;
  });

  const save = (at: string) =>
    writePlace(at, { scrollTop: scrollTop.current, slug: slug.current, view: view.current });

  const apply = (target: Target) => {
    const list = listRef.current;
    if (!list || list.clientHeight === 0) {
      pending.current = target;
      return;
    }
    pending.current = null;
    list.scrollTop = target.scrollTop;
    scrollTop.current = list.scrollTop;
    const link = target.slug
      ? list.querySelector<HTMLAnchorElement>(`article a[href="/homes/${target.slug}"]`)
      : null;
    const card = link?.closest("article");
    if (!link || !card) return;
    const box = list.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    // A different screen size (or new results) since then: bring the card itself into view.
    if (r.bottom < box.top + 40 || r.top > box.bottom - 40) {
      card.scrollIntoView({ block: "center" });
      scrollTop.current = list.scrollTop;
    }
    link.focus({ preventScroll: true });
    card.setAttribute("data-returned", "");
    setTimeout(() => card.removeAttribute("data-returned"), 2400);
  };

  // Restore when this search appears; save it when it goes (the cleanup keeps the old URL).
  useLayoutEffect(() => {
    const at = hereRef.current;
    const saved = readPlace(at);
    scrollTop.current = listRef.current?.scrollTop ?? 0;
    slug.current = saved?.slug ?? null;
    if (saved) {
      // List or map normally comes back with the URL; this covers a URL without it.
      const url = new URLSearchParams(window.location.search);
      if (saved.view === "map" && !url.getAll("view").includes("map")) setView("map");
      apply(saved);
    }
    return () => save(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Switching from the map to the list finishes a restore that had to wait.
  useLayoutEffect(() => {
    if (mobileView === "list" && pending.current) apply(pending.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileView]);

  // A reload, closing the tab, or the app going to the background.
  useEffect(() => {
    const onHide = () => save(hereRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return {
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      scrollTop.current = e.currentTarget.scrollTop;
    },
    /** The card the buyer just tapped; saved at once, before any navigation. */
    remember: (tapped: string) => {
      slug.current = tapped;
      save(hereRef.current);
    },
  };
}

/** "1 home", "3 rentals", "2 sold homes". */
function modeNoun(mode: SearchCriteria["mode"], n: number): string {
  const one = mode === "rent" ? "rental" : mode === "sold" ? "sold home" : "home";
  return n === 1 ? one : `${one}s`;
}

/**
 * No results (site review #5): never a dead end. It offers an email alert for this search,
 * the whole state, the nearest towns that have homes and, only when filters are on, a way
 * to clear them. The map meanwhile shows the place searched (`EmptyHelp.placeBounds`).
 */
function EmptyState({
  criteria,
  place,
  from,
  help,
  save,
  onBackToTown,
  onZoomOut,
  onClearFilters,
}: {
  criteria: SearchCriteria;
  /** The place searched, as the heading names it. */
  place?: string;
  from?: string;
  help?: EmptyHelp;
  save: SaveSearchState;
  onBackToTown: () => void;
  onZoomOut: () => void;
  onClearFilters: () => void;
}) {
  const filters = countActiveFilters(criteria) > 0;
  const hasBounds = !!criteria.bounds;
  const everywhere = listingNoun({ mode: criteria.mode, types: criteria.types }, { bare: true });
  const nearby = help?.nearby ?? [];
  const elsewhere = help?.elsewhere ?? [];
  const where = place ? `in ${place}` : hasBounds ? "in this map area" : `in ${site.coverage.name}`;
  const copy = noResultsCopy(criteria, where);
  return (
    <div
      className="flex flex-col items-center rounded-3xl border border-dashed border-line-strong px-6 py-12 text-center"
      data-testid="no-results"
    >
      <SearchX className="size-10 text-faint" strokeWidth={1.5} />
      <h2 className="mt-4 text-lg font-semibold text-ink">{copy.heading}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {filters
          ? `Try fewer filters${hasBounds ? " or a bigger map area" : ""}, or look nearby.`
          : copy.none}{" "}
        We can email you as soon as something lists.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button
          variant={save.saved ? "subtle" : "primary"}
          onClick={save.launch}
          disabled={save.saved}
        >
          {save.saved ? <Check /> : <BellPlus />}
          {save.saved ? "We’ll email you" : copy.alert}
        </Button>
        {elsewhere.map((e) => (
          <Link
            key={e.mode}
            href={searchHref({
              mode: e.mode,
              q: criteria.q,
              bounds: criteria.bounds,
              types: criteria.types,
            })}
            className="inline-flex h-11 items-center gap-1 rounded-full border border-line-strong bg-surface px-5 text-sm font-medium text-ink hover:border-faint pointer-fine:h-10"
            data-testid="other-mode"
          >
            {listingNoun({ mode: e.mode, types: criteria.types })} {where}{" "}
            <span className="text-muted tabular">({formatNumber(e.count)})</span>
          </Link>
        ))}
        <Link
          href={searchHref({ mode: criteria.mode, types: criteria.types })}
          className="inline-flex h-11 items-center rounded-full border border-line-strong bg-surface px-5 text-sm font-medium text-ink hover:border-faint pointer-fine:h-10"
        >
          See all {everywhere.charAt(0).toLowerCase() + everywhere.slice(1)} in {site.coverage.name}
        </Link>
        {hasBounds &&
          (from ? (
            <Button variant="secondary" onClick={onBackToTown}>
              Back to {from}
            </Button>
          ) : criteria.q ? (
            <Button variant="secondary" onClick={onZoomOut}>
              Search the whole area
            </Button>
          ) : null)}
        {filters && (
          <Button variant="ghost" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
      {nearby.length > 0 && (
        <nav aria-label="Nearby towns" className="mt-8 w-full max-w-sm text-left">
          <h3 className="text-sm font-semibold text-ink">Nearby towns with homes</h3>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
            {nearby.map((t) => (
              <li key={t.city}>
                <Link
                  href={buildSearchHref(
                    t.filtered ? criteria : { mode: criteria.mode, sort: "recommended", page: 1 },
                    { q: t.city, bounds: undefined },
                  )}
                  className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm text-ink hover:bg-sunken"
                >
                  <span className="font-medium">{t.city}</span>
                  <span className="text-muted tabular">
                    {t.count}{" "}
                    {t.filtered && filters
                      ? t.count === 1
                        ? "match"
                        : "matches"
                      : modeNoun(criteria.mode, t.count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
