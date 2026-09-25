"use client";

import { ChevronLeft, ChevronRight, Rotate3d } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/layout/logo";
import { Photo } from "@/components/ui/photo";
import { cn } from "@/lib/cn";
import {
  daysSince,
  formatBaths,
  formatCityLine,
  formatDate,
  formatNumber,
  formatPrice,
  formatPriceShort,
  formatShortOpenHouse,
  formatStreet,
  PROPERTY_TYPE_LABELS,
} from "@/lib/format";
import type { ListingCardData } from "@/lib/listings/card";
import { SaveButton } from "./save-button";

export function ListingCard({
  listing: l,
  highlighted = false,
  onHover,
  priority = false,
  sizes = "(min-width: 1536px) 22vw, (min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw",
}: {
  listing: ListingCardData;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
  priority?: boolean;
  sizes?: string;
}) {
  const sold = l.status === "closed";
  const unavailable = l.removedAt !== null;
  const price = sold && l.closePrice ? l.closePrice : l.listPrice;
  const rent = l.transactionType === "rent";

  return (
    <article
      className="group relative"
      onMouseEnter={() => onHover?.(l.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <Link
        href={`/homes/${l.slug}`}
        className="block rounded-[var(--radius-card)] focus-visible:outline-offset-4"
      >
        <div
          className={cn(
            "relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] bg-sunken shadow-card transition-shadow duration-300",
            highlighted ? "shadow-lift ring-2 ring-brand-500" : "group-hover:shadow-lift",
            unavailable && "grayscale",
          )}
        >
          <PhotoCarousel
            photos={l.photos}
            alt={formatStreet(l)}
            sizes={sizes}
            priority={priority}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-1.5 p-3">
            {cardBadges(l).slice(0, 2)}
          </div>
          {l.isCompanyListing && !unavailable && (
            <span className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-surface/95 py-1 pr-2.5 pl-1 text-[11px] font-semibold text-ink shadow-sm">
              <LogoMark className="size-4" />
              Adams listing
            </span>
          )}
          {l.hasVirtualTour && (
            <span className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-shade/70 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
              <Rotate3d className="size-3.5" /> 3D
            </span>
          )}
        </div>

        <div className="px-0.5 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xl font-semibold tracking-tight text-ink tabular">
              {unavailable ? (
                <span className="text-muted">No longer available</span>
              ) : (
                formatPrice(price)
              )}
              {rent && !unavailable && <span className="text-sm font-normal text-muted">/mo</span>}
            </p>
            {sold && l.closeDate && (
              <p className="text-xs text-muted">Sold {formatDate(l.closeDate)}</p>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-soft">
            {l.propertyType === "land" ? (
              <>Land · {l.lotSizeSqft ? `${(l.lotSizeSqft / 43_560).toFixed(2)} acres` : "—"}</>
            ) : (
              <>
                <Strong>{l.bedrooms ?? "—"}</Strong> bd <Dot />{" "}
                <Strong>{formatBaths(l.bathrooms)}</Strong> ba <Dot />{" "}
                <Strong>{formatNumber(l.livingAreaSqft)}</Strong> sqft
                <span className="hidden text-muted sm:inline">
                  {" "}
                  <Dot />{" "}
                  {PROPERTY_TYPE_LABELS[l.propertyType]?.replace("Single-family home", "House")}
                </span>
              </>
            )}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted" data-testid="card-address">
            {formatStreet(l)}, {formatCityLine(l)}
          </p>
          {l.listOfficeName && (
            <p className="mt-1 truncate text-[11px] tracking-wide text-faint uppercase">
              Listing by {l.listOfficeName}
            </p>
          )}
        </div>
      </Link>
      {!unavailable && (
        <div className="absolute top-2.5 right-2.5">
          <SaveButton listingId={l.id} />
        </div>
      )}
    </article>
  );
}

const Strong = ({ children }: { children: ReactNode }) => (
  <span className="font-semibold text-ink">{children}</span>
);
const Dot = () => <span className="mx-0.5 text-faint">·</span>;

function Badge({
  tone,
  children,
}: {
  tone: "brand" | "violet" | "amber" | "clay" | "brass" | "ink";
  children: ReactNode;
}) {
  const tones = {
    brand: "bg-primary text-white",
    violet: "bg-status-soon text-white",
    amber: "bg-status-pending text-shade",
    clay: "bg-clay-500 text-white",
    brass: "bg-surface text-brass-700",
    ink: "bg-shade/80 text-white",
  } as const;
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide shadow-sm",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

function cardBadges(l: ListingCardData): ReactNode[] {
  const out: ReactNode[] = [];
  if (l.removedAt)
    return [
      <Badge key="off" tone="ink">
        Off market
      </Badge>,
    ];
  if (l.status === "coming_soon")
    out.push(
      <Badge key="soon" tone="violet">
        Coming soon
      </Badge>,
    );
  if (l.status === "active_under_contract")
    out.push(
      <Badge key="uc" tone="amber">
        Under contract
      </Badge>,
    );
  if (l.status === "pending")
    out.push(
      <Badge key="p" tone="amber">
        Pending
      </Badge>,
    );
  if (l.status === "closed")
    out.push(
      <Badge key="sold" tone="clay">
        Sold
      </Badge>,
    );
  if (l.status === "active") {
    const age = daysSince(l.listDate);
    if (age !== null && age <= 7)
      out.push(
        <Badge key="new" tone="brand">
          New
        </Badge>,
      );
    if (l.nextOpenHouse)
      out.push(
        <Badge key="oh" tone="brass">
          {formatShortOpenHouse(l.nextOpenHouse)}
        </Badge>,
      );
    if (l.originalListPrice && l.originalListPrice > l.listPrice && l.transactionType === "sale") {
      out.push(
        <Badge key="cut" tone="clay">
          ↓ {formatPriceShort(l.originalListPrice - l.listPrice)}
        </Badge>,
      );
    }
  }
  return out;
}

function PhotoCarousel({
  photos,
  alt,
  sizes,
  priority,
}: {
  photos: string[];
  alt: string;
  sizes: string;
  priority: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (photos.length <= 1) {
    return (
      <Photo
        src={photos[0]}
        alt={alt}
        sizes={sizes}
        priority={priority}
        className="size-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
      />
    );
  }

  const go = (e: React.MouseEvent, dir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(photos.length - 1, index + dir));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <>
      <div
        ref={track}
        className="scrollbar-none flex size-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {photos.map((src, i) => (
          <Photo
            key={src + i}
            src={src}
            alt={i === 0 ? alt : `${alt} — photo ${i + 1}`}
            sizes={sizes}
            priority={priority && i === 0}
            className="size-full shrink-0 snap-center"
          />
        ))}
      </div>
      <CarouselArrow side="left" hidden={index === 0} onClick={(e) => go(e, -1)} />
      <CarouselArrow side="right" hidden={index === photos.length - 1} onClick={(e) => go(e, 1)} />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1">
        {photos.map((_, i) => (
          <span
            key={i}
            className={cn(
              "size-1.5 rounded-full bg-white shadow transition-opacity",
              i === index ? "opacity-100" : "opacity-50",
            )}
          />
        ))}
      </div>
    </>
  );
}

function CarouselArrow({
  side,
  hidden,
  onClick,
}: {
  side: "left" | "right";
  hidden: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className={cn(
        "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-ink opacity-0 shadow transition-opacity group-hover:opacity-100 hover:bg-surface",
        side === "left" ? "left-2.5" : "right-2.5",
        hidden && "invisible",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
