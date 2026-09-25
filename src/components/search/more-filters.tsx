"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { FEATURE_FLAGS, type FeatureFlag, type SearchCriteria } from "@/lib/search/params";

const FEATURE_LABELS: Record<FeatureFlag, string> = {
  garage: "Garage",
  pool: "Private pool",
  waterfront: "Waterfront",
  view: "View",
  basement: "Basement",
  newConstruction: "New construction",
  singleStory: "Single story",
  openHouse: "Open house",
  virtualTour: "3D / virtual tour",
  ourListings: "Adams Realty listings only",
};

const SQFT = [500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3500, 4000, 5000, 7500];
const LOTS = [
  [2_000, "2,000 sqft"],
  [5_000, "5,000 sqft"],
  [7_500, "7,500 sqft"],
  [10_890, "¼ acre"],
  [21_780, "½ acre"],
  [43_560, "1 acre"],
  [87_120, "2 acres"],
  [217_800, "5 acres"],
  [435_600, "10 acres"],
] as const;
const YEARS = [1900, 1950, 1970, 1980, 1990, 2000, 2010, 2015, 2020, 2024];
const HOA = [0, 50, 100, 200, 300, 500, 750, 1000];
const DOM = [
  [1, "Last 24 hours"],
  [7, "Last 7 days"],
  [14, "Last 14 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
] as const;

type Draft = Pick<
  SearchCriteria,
  | "minSqft"
  | "maxSqft"
  | "minLotSqft"
  | "minYear"
  | "maxYear"
  | "maxHoa"
  | "maxDaysOnMarket"
  | "pending"
  | "soldWithinDays"
  | FeatureFlag
>;

function pickDraft(c: SearchCriteria): Draft {
  const d: Draft = {
    minSqft: c.minSqft,
    maxSqft: c.maxSqft,
    minLotSqft: c.minLotSqft,
    minYear: c.minYear,
    maxYear: c.maxYear,
    maxHoa: c.maxHoa,
    maxDaysOnMarket: c.maxDaysOnMarket,
    pending: c.pending,
    soldWithinDays: c.soldWithinDays,
  };
  for (const f of FEATURE_FLAGS) d[f] = c[f];
  return d;
}

const num = (v: string) => (v === "" ? undefined : Number(v));

export function MoreFilters({
  open,
  onClose,
  criteria,
  update,
}: {
  open: boolean;
  onClose: () => void;
  criteria: SearchCriteria;
  update: (patch: Partial<SearchCriteria>) => void;
}) {
  const [d, setD] = useState<Draft>(() => pickDraft(criteria));
  // Start each opening from the current URL criteria.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setD(pickDraft(criteria));
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const reset = () => {
    const cleared = Object.fromEntries(
      Object.keys(pickDraft(criteria)).map((k) => [k, undefined]),
    ) as Draft;
    setD(cleared);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="More filters"
      footer={
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={reset}>
            Reset all
          </Button>
          <Button
            onClick={() => {
              update(d);
              onClose();
            }}
          >
            Show results
          </Button>
        </div>
      }
    >
      <div className="space-y-8 px-6 py-6">
        {criteria.mode === "buy" && (
          <Checkbox
            label="Include under contract & pending"
            checked={!!d.pending}
            onChange={(e) => set("pending", e.target.checked || undefined)}
          />
        )}
        {criteria.mode === "sold" && (
          <Field label="Sold within" htmlFor="soldWithin">
            <Select
              id="soldWithin"
              value={d.soldWithinDays ?? ""}
              onChange={(e) => set("soldWithinDays", num(e.target.value))}
            >
              <option value="">Last 12 months</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 3 months</option>
              <option value="180">Last 6 months</option>
              <option value="730">Last 2 years</option>
            </Select>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Min square feet" htmlFor="minSqft">
            <Select
              id="minSqft"
              value={d.minSqft ?? ""}
              onChange={(e) => set("minSqft", num(e.target.value))}
            >
              <option value="">No min</option>
              {SQFT.map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString()} sqft
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max square feet" htmlFor="maxSqft">
            <Select
              id="maxSqft"
              value={d.maxSqft ?? ""}
              onChange={(e) => set("maxSqft", num(e.target.value))}
            >
              <option value="">No max</option>
              {SQFT.map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString()} sqft
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Min lot size" htmlFor="minLot">
            <Select
              id="minLot"
              value={d.minLotSqft ?? ""}
              onChange={(e) => set("minLotSqft", num(e.target.value))}
            >
              <option value="">Any</option>
              {LOTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}+
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max HOA" htmlFor="maxHoa">
            <Select
              id="maxHoa"
              value={d.maxHoa ?? ""}
              onChange={(e) => set("maxHoa", num(e.target.value))}
            >
              <option value="">Any</option>
              {HOA.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "No HOA fee" : `$${v}/mo`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year built — from" htmlFor="minYear">
            <Select
              id="minYear"
              value={d.minYear ?? ""}
              onChange={(e) => set("minYear", num(e.target.value))}
            >
              <option value="">Any</option>
              {YEARS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year built — to" htmlFor="maxYear">
            <Select
              id="maxYear"
              value={d.maxYear ?? ""}
              onChange={(e) => set("maxYear", num(e.target.value))}
            >
              <option value="">Any</option>
              {YEARS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          {criteria.mode !== "sold" && (
            <Field label="Listed" htmlFor="dom">
              <Select
                id="dom"
                value={d.maxDaysOnMarket ?? ""}
                onChange={(e) => set("maxDaysOnMarket", num(e.target.value))}
              >
                <option value="">Any time</option>
                {DOM.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">Must have</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FEATURE_FLAGS.map((f) => (
              <Checkbox
                key={f}
                label={FEATURE_LABELS[f]}
                checked={!!d[f]}
                onChange={(e) => set(f, e.target.checked || undefined)}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
