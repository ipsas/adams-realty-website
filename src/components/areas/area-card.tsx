import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Photo } from "@/components/ui/photo";
import { areaHref, countyLabel, type Area } from "@/config/areas";
import { cn } from "@/lib/cn";
import { formatNumber, formatPriceShort } from "@/lib/format";
import { regionLabel, type AreaStats } from "@/lib/areas/stats";

/** "Hartwell · 3 counties" / "Franklin County"; long county lists collapse to a count on cards. */
function placeLine(area: Area): string {
  const county = area.counties.length > 2 ? `${area.counties.length} counties` : countyLabel(area);
  return area.city === area.name ? county : `${area.city} · ${county}`;
}

/** Index card: photo of the area's featured home, name, and three live numbers. */
export function AreaCard({
  area,
  stats,
  priority = false,
  showRegion = false,
}: {
  area: Area;
  stats: AreaStats;
  priority?: boolean;
  /** Label the region on the photo (for flat, sorted lists). */
  showRegion?: boolean;
}) {
  return (
    <Link href={areaHref(area)} className="group block rounded-[var(--radius-card)]">
      <div className="relative isolate aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] bg-brand-800 shadow-card transition-shadow duration-300 group-hover:shadow-lift">
        <AreaPhoto
          stats={stats}
          priority={priority}
          sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw"
        />
        {showRegion && (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-ink shadow-sm">
            {regionLabel(area.region)}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5 xl:p-4">
          <h3 className="font-display-tight text-2xl leading-tight font-medium xl:text-[1.375rem]">
            {area.name}
          </h3>
          <p className="mt-1 truncate text-sm text-white/75">{placeLine(area)}</p>
        </div>
      </div>
      <AreaFigures stats={stats} className="mt-3" />
    </Link>
  );
}

/**
 * Wide variant for a region with a single guide, so it reads as a feature
 * rather than one lonely tile in a five-column grid.
 */
export function AreaFeatureCard({
  area,
  stats,
  priority = false,
}: {
  area: Area;
  stats: AreaStats;
  priority?: boolean;
}) {
  return (
    <Link
      href={areaHref(area)}
      className="group grid grid-cols-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card transition-shadow duration-300 hover:shadow-lift lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
    >
      <div className="relative isolate aspect-[16/10] bg-brand-800 lg:aspect-auto lg:min-h-80">
        <AreaPhoto stats={stats} priority={priority} sizes="(min-width: 1024px) 55vw, 100vw" />
        <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-7">
          <h3 className="font-display-tight text-3xl leading-tight font-medium sm:text-4xl">
            {area.name}
          </h3>
          <p className="mt-1 text-sm text-white/75">
            {area.city === area.name ? countyLabel(area) : `${area.city} · ${countyLabel(area)}`}
          </p>
        </div>
      </div>
      <div className="flex flex-col p-6 sm:p-8">
        <p className="leading-relaxed text-ink-soft">{area.description}</p>
        <ul className="mt-5 space-y-2 text-sm text-muted">
          {area.highlights.slice(0, 3).map((h) => (
            <li key={h} className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brass-400" />
              {h}
            </li>
          ))}
        </ul>
        <AreaFigures stats={stats} className="mt-6" />
        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 lg:mt-auto lg:pt-6">
          Read the {area.name} guide
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function AreaPhoto({
  stats,
  priority,
  sizes,
}: {
  stats: AreaStats;
  priority: boolean;
  sizes: string;
}) {
  return (
    <>
      <Photo
        src={stats.photo}
        alt=""
        priority={priority}
        sizes={sizes}
        className="absolute inset-0 -z-20 size-full transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        fallbackClassName="from-brand-600 via-brand-700 to-brand-900 text-brand-500"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/80 via-ink/15 to-transparent" />
    </>
  );
}

function AreaFigures({ stats, className }: { stats: AreaStats; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface py-2.5 text-center",
        className,
      )}
    >
      <Figure label="For sale" value={formatNumber(stats.forSale)} />
      <Figure
        label="Median list"
        value={stats.medianListPrice ? formatPriceShort(stats.medianListPrice) : "—"}
      />
      <Figure label="Sold · 6 mo" value={formatNumber(stats.recentSales)} />
    </dl>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse px-1">
      <dt className="truncate text-[11px] text-muted">{label}</dt>
      <dd className="text-base font-semibold text-ink tabular">{value}</dd>
    </div>
  );
}
