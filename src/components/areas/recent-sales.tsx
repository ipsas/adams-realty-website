import Link from "next/link";
import { Photo } from "@/components/ui/photo";
import {
  formatBaths,
  formatDate,
  formatLot,
  formatNumber,
  formatPrice,
  formatStreet,
} from "@/lib/format";
import { formatRatio } from "@/lib/areas/stats";
import { landSummary } from "@/lib/listings/land";
import type { CardRow } from "@/lib/listings/card";

/**
 * Compact rows of recent closed sales: what sold, for how much, and against
 * the asking price. Most are other brokerages' MLS listings, so each row
 * credits the listing office, as ListingCard does (IDX rules).
 */
export function RecentSales({ sales }: { sales: CardRow[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {sales.map((s) => {
        const ratio = s.closePrice && s.listPrice ? s.closePrice / s.listPrice : null;
        return (
          <li key={s.id}>
            <Link
              href={`/homes/${s.slug}`}
              className="flex items-center gap-4 p-3 transition-colors hover:bg-sunken/60 sm:p-4"
            >
              <Photo
                src={s.primaryPhotoUrl}
                alt=""
                sizes="80px"
                className="size-16 shrink-0 rounded-xl sm:size-20"
                fallbackClassName="[&>svg]:size-6"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{formatStreet(s)}</p>
                <p className="mt-0.5 truncate text-sm text-muted">{saleFacts(s)}</p>
                <p className="mt-0.5 text-xs text-muted sm:hidden">
                  Sold {formatDate(s.closeDate)}
                </p>
                {s.listOfficeName && (
                  <p className="mt-0.5 truncate text-sm text-muted">
                    Listing by {s.listOfficeName}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-ink tabular">{formatPrice(s.closePrice)}</p>
                <p className="mt-0.5 text-xs text-muted tabular">
                  <span className="hidden sm:inline">Sold {formatDate(s.closeDate)} · </span>
                  {ratio ? `${formatRatio(ratio)} of list` : ""}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** "3 bd · 2 ba · 1,850 sqft", or the facts that matter for land, farms and commercial. */
function saleFacts(s: CardRow): string {
  // Bare land and farms: acres and price per acre (site review #8).
  const land = landSummary({ ...s, price: s.closePrice ?? s.listPrice });
  if (land) return land;
  const lot = s.lotSizeSqft ? formatLot(s.lotSizeSqft).replace(" lot", "") : null;
  switch (s.propertyType) {
    case "commercial":
      return s.livingAreaSqft
        ? `Commercial · ${formatNumber(s.livingAreaSqft)} sqft`
        : "Commercial";
    case "farm_ranch":
      return `${s.bedrooms ?? "—"} bd · ${formatBaths(s.bathrooms)} ba${lot ? ` · ${lot}` : ""}`;
    default:
      return `${s.bedrooms ?? "—"} bd · ${formatBaths(s.bathrooms)} ba · ${formatNumber(s.livingAreaSqft)} sqft`;
  }
}
