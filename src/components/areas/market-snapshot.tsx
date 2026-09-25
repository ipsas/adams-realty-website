import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatPriceShort } from "@/lib/format";
import {
  formatRatio,
  MIN_SAMPLE,
  mixSegments,
  NEW_WINDOW_DAYS,
  sampleLabel,
  SOLD_WINDOW_DAYS,
  type AreaStats,
} from "@/lib/areas/stats";

type Tile = { label: string; value: string; note: ReactNode };

/**
 * Six live figures plus the property-type mix. Every median says how many
 * homes it's drawn from, and thin samples are flagged rather than hidden:
 * an honest "2 sales" beats a confident-looking number with nothing behind it.
 */
export function MarketSnapshot({ stats, rentalsHref }: { stats: AreaStats; rentalsHref: string }) {
  const s = stats;
  const small = (n: number) =>
    n > 0 && n < MIN_SAMPLE ? <span className="text-clay-600"> · small sample</span> : null;

  const tiles: Tile[] = [
    {
      label: "Homes for sale",
      value: formatNumber(s.forSale),
      note: s.underContract
        ? `Plus ${s.underContract} under contract`
        : s.forSale
          ? "None under contract"
          : "Nothing listed right now",
    },
    {
      label: "Median list price",
      value: s.medianListPrice ? formatPriceShort(s.medianListPrice) : "—",
      note:
        s.minListPrice && s.maxListPrice && s.forSale > 1 ? (
          <>
            {formatPriceShort(s.minListPrice)} – {formatPriceShort(s.maxListPrice)} range
            {small(s.forSale)}
          </>
        ) : s.forSale === 1 ? (
          <>One home for sale{small(1)}</>
        ) : (
          "No asking prices to report"
        ),
    },
    {
      label: "Median price per sq ft",
      value: s.medianPricePerSqft ? `$${formatNumber(s.medianPricePerSqft)}` : "—",
      note: s.pricePerSqftSample ? (
        <>
          From {sampleLabel(s.pricePerSqftSample, ["home", "homes"])} with living area
          {small(s.pricePerSqftSample)}
        </>
      ) : (
        "No square footage to report"
      ),
    },
    {
      label: "Median days on market",
      value: s.medianDaysOnMarket === null ? "—" : formatNumber(s.medianDaysOnMarket),
      note: s.daysOnMarketSample ? (
        <>
          Across {sampleLabel(s.daysOnMarketSample, ["active listing", "active listings"])}
          {small(s.daysOnMarketSample)}
        </>
      ) : (
        "No active listings"
      ),
    },
    {
      label: `New listings, last ${NEW_WINDOW_DAYS} days`,
      value: formatNumber(s.newListings),
      note: "Includes any now under contract or sold",
    },
    {
      label: "Sales, last 6 months",
      value: formatNumber(s.recentSales),
      note:
        s.recentSales && s.medianSoldPrice ? (
          <>
            Median {formatPriceShort(s.medianSoldPrice)}
            {s.medianSaleToList ? ` · ${formatRatio(s.medianSaleToList)} of list` : ""}
            {small(s.recentSales)}
          </>
        ) : (
          `No closed sales in ${SOLD_WINDOW_DAYS} days`
        ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col bg-surface px-4 py-5 sm:px-6 sm:py-6">
            <dt className="text-xs font-medium text-ink-soft sm:text-sm">{t.label}</dt>
            <dd className="order-first mt-0 text-2xl font-semibold tracking-tight text-ink tabular sm:text-3xl">
              {t.value}
            </dd>
            <dd className="mt-2 text-xs leading-snug text-muted">{t.note}</dd>
          </div>
        ))}
      </dl>
      <TypeMix stats={s} rentalsHref={rentalsHref} />
    </div>
  );
}

/**
 * Part-to-whole bar of what's for sale by property type. Colors are fixed per
 * type (see MIX_BUCKETS); the legend doubles as the data table, so nothing
 * depends on hovering or on telling colors apart.
 */
function TypeMix({ stats, rentalsHref }: { stats: AreaStats; rentalsHref: string }) {
  const segments = mixSegments(stats.mix);
  const summary = segments.map((s) => `${s.label} ${s.count} (${s.pct}%)`).join(", ");
  return (
    <section
      aria-labelledby="type-mix-heading"
      className="flex flex-col overflow-x-clip rounded-2xl border border-line bg-surface p-5 sm:p-6"
    >
      <h3 id="type-mix-heading" className="text-sm font-semibold text-ink">
        What&apos;s for sale
      </h3>
      <p className="mt-0.5 text-xs text-muted">
        {segments.length
          ? `By property type · ${sampleLabel(stats.forSale, ["home", "homes"])}`
          : "Nothing for sale right now"}
      </p>
      {segments.length > 0 ? (
        <>
          <div role="img" aria-label={summary} className="mt-5 flex gap-[2px]">
            {segments.map((s, i) => (
              <div key={s.key} className="group relative py-2" style={{ flex: `${s.count} 1 0%` }}>
                <div
                  className={cn(
                    "h-3 transition-[filter] group-hover:brightness-110",
                    i === segments.length - 1 && "rounded-r-[4px]",
                  )}
                  style={{ backgroundColor: s.color }}
                />
                <span
                  className={cn(
                    "pointer-events-none absolute bottom-full z-10 mb-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-on-ink opacity-0 shadow-pop transition-opacity group-hover:opacity-100",
                    // Edge segments anchor to their edge so the tooltip never leaves the card.
                    i === 0
                      ? "left-0"
                      : i === segments.length - 1
                        ? "right-0"
                        : "left-1/2 -translate-x-1/2",
                  )}
                >
                  <span className="font-semibold tabular">{s.count}</span>{" "}
                  <span className="text-on-ink/70">
                    {s.label.toLowerCase()} · {s.pct}%
                  </span>
                </span>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-2.5 text-sm">
            {segments.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-ink-soft">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.label}
                </span>
                <span className="text-ink tabular">
                  {s.count}
                  <span className="ml-2 inline-block w-10 text-right text-muted">{s.pct}%</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-muted">
          When homes list here, you&apos;ll see the mix of houses, land and more.
        </p>
      )}
      {stats.rentals > 0 && (
        <div className="mt-auto pt-4">
          <Link
            href={rentalsHref}
            className="group flex min-h-11 items-center justify-between border-t border-line pt-3 text-sm text-ink-soft hover:text-ink"
          >
            Also {sampleLabel(stats.rentals, ["home", "homes"])} for rent
            <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </section>
  );
}
