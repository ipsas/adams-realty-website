import { Search, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { cn } from "@/lib/cn";

// Status tabs and address search for Dashboard → Listings. The URL is the
// source of truth (?status=sold&q=oak), so filtered views are linkable and
// survive back/forward. Filtering helpers are pure and unit-tested.

const BASE = "/dashboard/listings";

export const STATUS_TABS = [
  { key: "", label: "All", statuses: null },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "coming-soon", label: "Coming soon", statuses: ["coming_soon"] },
  {
    key: "under-contract",
    label: "Under contract & pending",
    statuses: ["active_under_contract", "pending"],
  },
  { key: "sold", label: "Sold", statuses: ["closed"] },
  { key: "off-market", label: "Off market", statuses: ["withdrawn", "expired", "canceled"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly string[] | null }[];

export type StatusTab = (typeof STATUS_TABS)[number]["key"];

export type ListingsFilterValue = { status: StatusTab; q: string };

type Filterable = {
  status: string;
  addressLine1: string;
  unitNumber: string | null;
  city: string;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads `?status=&q=` leniently: unknown statuses fall back to All, and the query is tidied. */
export function parseListingsFilter(
  params: Record<string, string | string[] | undefined>,
): ListingsFilterValue {
  const status = first(params.status) ?? "";
  const q = (first(params.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return {
    status: STATUS_TABS.some((t) => t.key === status) ? (status as StatusTab) : "",
    q,
  };
}

/** The listings URL for a filter, omitting defaults. */
export function listingsHref({ status, q }: ListingsFilterValue): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

function tabFor(status: string): StatusTab | null {
  return STATUS_TABS.find((t) => t.statuses?.some((s) => s === status))?.key ?? null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[#.,]/g, " ").replace(/\s+/g, " ").trim();

/** Every word of the query must appear in the street, unit or city ("oak decatur" matches). */
export function matchesAddress(row: Filterable, q: string): boolean {
  const words = normalize(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = normalize(`${row.addressLine1} ${row.unitNumber ?? ""} ${row.city}`);
  return words.every((w) => haystack.includes(w));
}

/**
 * Applies the filter. Tab counts reflect the address search, so they say how
 * many matches each tab would show.
 */
export function filterListings<T extends Filterable>(rows: T[], filter: ListingsFilterValue) {
  const matching = filter.q ? rows.filter((r) => matchesAddress(r, filter.q)) : rows;
  const counts = Object.fromEntries(STATUS_TABS.map((t) => [t.key, 0])) as Record<
    StatusTab,
    number
  >;
  for (const r of matching) {
    counts[""]++;
    const tab = tabFor(r.status);
    if (tab) counts[tab]++;
  }
  const shown = filter.status
    ? matching.filter((r) => tabFor(r.status) === filter.status)
    : matching;
  return { rows: shown, counts };
}

export function ListingsFilter({
  filter,
  counts,
}: {
  filter: ListingsFilterValue;
  counts: Record<StatusTab, number>;
}) {
  return (
    // One row when the content area is wide enough for every tab plus the search box.
    <div className="@container mb-5">
      <div className="flex flex-col gap-3 @[68rem]:flex-row @[68rem]:items-center @[68rem]:justify-between">
        <nav
          aria-label="Filter by status"
          className="-mx-4 scrollbar-none flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {STATUS_TABS.map((t) => {
            const active = filter.status === t.key;
            return (
              <Link
                key={t.key}
                href={listingsHref({ status: t.key, q: filter.q })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-ink text-white" : "text-ink-soft hover:bg-sunken hover:text-ink",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs tabular",
                    active ? "bg-white/15 text-white" : "bg-sunken text-muted",
                  )}
                >
                  {counts[t.key]}
                </span>
              </Link>
            );
          })}
        </nav>

        <Form
          action={BASE}
          replace
          scroll={false}
          role="search"
          aria-label="Search listings by address"
          className="relative w-full sm:max-w-sm @[68rem]:w-72"
        >
          {filter.status && <input type="hidden" name="status" value={filter.status} />}
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint"
          />
          <input
            // Remount when the URL changes (e.g. "Clear") so the box shows the current query.
            key={filter.q}
            type="search"
            name="q"
            defaultValue={filter.q}
            placeholder="Search by address or city"
            aria-label="Search by address or city"
            autoComplete="off"
            enterKeyHint="search"
            className="h-10 w-full rounded-full border border-line-strong bg-surface pr-11 pl-10 text-base text-ink transition-colors outline-none placeholder:text-faint hover:border-faint focus:border-brand-500 focus:ring-3 focus:ring-brand-100 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {filter.q && (
            <Link
              href={listingsHref({ status: filter.status, q: "" })}
              replace
              scroll={false}
              aria-label="Clear search"
              className="absolute top-0 right-0 inline-flex size-10 items-center justify-center rounded-full text-muted hover:text-ink"
            >
              <X className="size-4" />
            </Link>
          )}
        </Form>
      </div>
    </div>
  );
}
