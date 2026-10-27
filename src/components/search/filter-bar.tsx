"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { formatPriceShort } from "@/lib/format";
import {
  countActiveFilters,
  PROPERTY_TYPES,
  propertyTypeLabel,
  type PropertyTypeValue,
  type SearchCriteria,
  type SearchMode,
} from "@/lib/search/params";
import { LocationSearch } from "./location-search";
import { MoreFilters } from "./more-filters";
import type { SearchUpdate } from "./use-search-nav";

// Low steps matter here: land, manufactured homes and small-town houses often list under $200K.
const SALE_PRICES = [
  50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 500_000, 600_000, 750_000,
  1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000,
];
const RENT_PRICES = [
  500, 750, 1_000, 1_250, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 7_500, 10_000,
];
const VISIBLE_TYPES: PropertyTypeValue[] = [
  "single_family",
  "land",
  "farm_ranch",
  "manufactured",
  "townhouse",
  "condo",
  "multi_family",
  "commercial",
];

export function FilterBar({
  criteria: c,
  update,
  bedOnMainUpdating,
}: {
  criteria: SearchCriteria;
  update: SearchUpdate;
  signedIn: boolean;
  bedOnMainUpdating: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const extra = countActiveFilters({
    ...c,
    minPrice: undefined,
    maxPrice: undefined,
    beds: undefined,
    baths: undefined,
    types: undefined,
  });

  return (
    <div className="border-b border-line bg-canvas">
      <div className="flex flex-col gap-2 px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
        <LocationSearch
          className="w-full shrink-0 lg:w-64 xl:w-80"
          defaultValue={c.q ?? ""}
          // A new place replaces the map area, and is a new search: Back returns to the last one.
          onSearch={(q) => update({ q: q || undefined, bounds: undefined }, { push: true })}
        />
        {/* Scrolls horizontally on small screens; popovers render as bottom sheets there. */}
        <div className="-mx-4 scrollbar-none flex flex-1 items-center gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0">
          <ModeToggle
            mode={c.mode}
            onChange={(mode) =>
              update({ mode, minPrice: undefined, maxPrice: undefined, sort: "recommended" })
            }
          />

          <Popover
            label={priceLabel(c)}
            active={c.minPrice !== undefined || c.maxPrice !== undefined}
          >
            <PricePanel c={c} update={update} />
          </Popover>

          <Popover label={bedBathLabel(c)} active={c.beds !== undefined || c.baths !== undefined}>
            <div className="space-y-5">
              <ChipGroup
                label="Bedrooms"
                options={[undefined, 1, 2, 3, 4, 5]}
                value={c.beds}
                format={(v) => (v === undefined ? "Any" : `${v}+`)}
                onChange={(beds) => update({ beds })}
              />
              <ChipGroup
                label="Bathrooms"
                options={[undefined, 1, 1.5, 2, 3, 4]}
                value={c.baths}
                format={(v) => (v === undefined ? "Any" : `${v}+`)}
                onChange={(baths) => update({ baths })}
              />
            </div>
          </Popover>

          <Popover label={typeLabel(c)} active={!!c.types?.length}>
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-ink">Property type</legend>
              <div className="grid grid-cols-2 gap-2">
                {VISIBLE_TYPES.map((t) => {
                  const checked = c.types?.includes(t) ?? false;
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => {
                        const set = new Set(c.types ?? []);
                        if (checked) set.delete(t);
                        else set.add(t);
                        update({
                          types: set.size ? PROPERTY_TYPES.filter((x) => set.has(x)) : undefined,
                        });
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                        checked
                          ? "border-brand-700 bg-brand-50 text-brand-800"
                          : "border-line-strong text-ink-soft hover:border-faint",
                      )}
                    >
                      {propertyTypeLabel(t)}
                    </button>
                  );
                })}
              </div>
              {/* Site review #5: commercial isn't a home, so it's in only when picked. */}
              <p className="mt-3 max-w-64 text-xs text-muted">
                With no type picked, you see every type except commercial.
              </p>
            </fieldset>
          </Popover>

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
              extra
                ? "border-brand-700 bg-brand-50 text-brand-800"
                : "border-line-strong bg-surface text-ink-soft hover:border-faint hover:text-ink",
            )}
          >
            <SlidersHorizontal className="size-4" />
            More
            {extra > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-white">
                {extra}
              </span>
            )}
          </button>
        </div>
      </div>
      <MoreFilters
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        criteria={c}
        update={update}
        bedOnMainUpdating={bedOnMainUpdating}
      />
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: SearchMode; onChange: (m: SearchMode) => void }) {
  const modes: { value: SearchMode; label: string }[] = [
    { value: "buy", label: "For sale" },
    { value: "rent", label: "For rent" },
    { value: "sold", label: "Sold" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Listing type"
      className="flex h-10 shrink-0 rounded-full border border-line-strong bg-surface p-1"
    >
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          onClick={() => mode !== m.value && onChange(m.value)}
          className={cn(
            "rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors",
            mode === m.value ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

function PricePanel({
  c,
  update,
}: {
  c: SearchCriteria;
  update: (p: Partial<SearchCriteria>) => void;
}) {
  const presets = c.mode === "rent" ? RENT_PRICES : SALE_PRICES;
  const opt = (v: number) => (
    <option key={v} value={v}>
      {c.mode === "rent" ? `$${v.toLocaleString()}` : formatPriceShort(v)}
    </option>
  );
  return (
    <div className="w-72">
      <p className="mb-3 text-sm font-semibold text-ink">
        {c.mode === "rent" ? "Monthly rent" : "Price"}
      </p>
      <div className="flex items-center gap-2">
        <Select
          aria-label="Minimum price"
          value={c.minPrice ?? ""}
          onChange={(e) =>
            update({ minPrice: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">No min</option>
          {presets.filter((v) => !c.maxPrice || v < c.maxPrice).map(opt)}
        </Select>
        <span className="text-faint">–</span>
        <Select
          aria-label="Maximum price"
          value={c.maxPrice ?? ""}
          onChange={(e) =>
            update({ maxPrice: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">No max</option>
          {presets.filter((v) => !c.minPrice || v > c.minPrice).map(opt)}
        </Select>
      </div>
      {(c.minPrice !== undefined || c.maxPrice !== undefined) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 -ml-2"
          onClick={() => update({ minPrice: undefined, maxPrice: undefined })}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

function ChipGroup<T extends number | undefined>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  format: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-semibold text-ink">{label}</legend>
      <div className="flex overflow-hidden rounded-xl border border-line-strong">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn(
              "h-10 min-w-12 flex-1 border-l border-line-strong px-2 text-sm font-medium first:border-l-0",
              value === o ? "bg-ink text-on-ink" : "text-ink-soft hover:bg-sunken",
            )}
          >
            {format(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function priceLabel(c: SearchCriteria): string {
  const f = (n: number) => (c.mode === "rent" ? `$${n.toLocaleString()}` : formatPriceShort(n));
  if (c.minPrice !== undefined && c.maxPrice !== undefined)
    return `${f(c.minPrice)}–${f(c.maxPrice)}`;
  if (c.minPrice !== undefined) return `${f(c.minPrice)}+`;
  if (c.maxPrice !== undefined) return `Up to ${f(c.maxPrice)}`;
  return "Price";
}

function bedBathLabel(c: SearchCriteria): string {
  if (c.beds === undefined && c.baths === undefined) return "Beds & baths";
  return [c.beds !== undefined && `${c.beds}+ bd`, c.baths !== undefined && `${c.baths}+ ba`]
    .filter(Boolean)
    .join(", ");
}

function typeLabel(c: SearchCriteria): string {
  if (!c.types?.length) return "Property type";
  if (c.types.length === 1) return propertyTypeLabel(c.types[0]);
  return `Property type (${c.types.length})`;
}
