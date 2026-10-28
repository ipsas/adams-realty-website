"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Dialog } from "@/components/ui/dialog";
import { GEORGIA_COUNTIES } from "@/config/georgia-counties";
import { normalizeCounty } from "@/lib/areas/county-name";
import {
  allowsPriceReduced,
  explicitCountyQuery,
  FEATURE_FLAGS,
  parseCounties,
  type FeatureFlag,
  type SearchCriteria,
} from "@/lib/search/params";
import type { SchoolOptions } from "@/lib/search/school-options";
import { FEATURE_ARIA_LABELS, FEATURE_LABELS } from "./feature-labels";

/** The checkboxes the "still updating" notice is about. */
const BED_ON_MAIN_FLAGS: readonly FeatureFlag[] = ["primaryOnMain", "bedOnMain"];

const SCHOOL_FIELDS = [
  ["elementary", "Elementary school"],
  ["middle", "Middle school"],
  ["high", "High school"],
] as const;

const SQFT = [500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3500, 4000, 5000, 7500];
const ACRES: [number, string][] = [
  [0.25, "¼ acre"],
  [0.5, "½ acre"],
  [1, "1 acre"],
  [2, "2 acres"],
  [5, "5 acres"],
  [10, "10 acres"],
  [25, "25 acres"],
];

/** ACRES, plus the current value when a URL (or a legacy min lot size) set another. */
function acreOptions(value: number | undefined): [number, string][] {
  if (value === undefined || ACRES.some(([v]) => v === value)) return ACRES;
  return [...ACRES, [value, `${value} acres`] as [number, string]].sort((a, b) => a[0] - b[0]);
}
const YEARS = [1900, 1950, 1970, 1980, 1990, 2000, 2010, 2015, 2020, 2024];
const HOA = [0, 50, 100, 200, 300, 500, 750, 1000];
const DOM = [
  [1, "Last 24 hours"],
  [7, "Last 7 days"],
  [14, "Last 14 days"],
  [30, "Last 30 days"],
  [90, "Last 90 days"],
] as const;

/** Each county with its key, for the county list's "find a county" box. */
const COUNTY_KEYS = GEORGIA_COUNTIES.map((name) => ({ name, key: normalizeCounty(name) }));

type Draft = Pick<
  SearchCriteria,
  | "counties"
  | "elementary"
  | "middle"
  | "high"
  | "minSqft"
  | "maxSqft"
  | "minAcres"
  | "maxAcres"
  | "minYear"
  | "maxYear"
  | "maxHoa"
  | "hoa"
  | "kw"
  | "priceReduced"
  | "age55"
  | "maxDaysOnMarket"
  | "pending"
  | "soldWithinDays"
  | FeatureFlag
>;

function pickDraft(c: SearchCriteria): Draft {
  const qCounty = explicitCountyQuery(c.q);
  const d: Draft = {
    // The location box's county ("Hall County") opens checked: it folds into the filter.
    counties: qCounty ? parseCounties([...(c.counties ?? []), qCounty]) : c.counties,
    elementary: c.elementary,
    middle: c.middle,
    high: c.high,
    minSqft: c.minSqft,
    maxSqft: c.maxSqft,
    // A legacy min lot size (old saved searches and links) opens as min acres.
    minAcres:
      c.minAcres ??
      (c.minLotSqft !== undefined ? Math.round((c.minLotSqft / 43_560) * 100) / 100 : undefined),
    maxAcres: c.maxAcres,
    minYear: c.minYear,
    maxYear: c.maxYear,
    maxHoa: c.maxHoa,
    hoa: c.hoa,
    kw: c.kw,
    priceReduced: c.priceReduced,
    age55: c.age55,
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
  bedOnMainUpdating,
}: {
  open: boolean;
  onClose: () => void;
  criteria: SearchCriteria;
  update: (patch: Partial<SearchCriteria>) => void;
  /** The mapper's remap hasn't filled the bedroom-on-main columns yet. */
  bedOnMainUpdating: boolean;
}) {
  const [d, setD] = useState<Draft>(() => pickDraft(criteria));
  const updatingId = useId();
  const [countyFilter, setCountyFilter] = useState("");
  // Start each opening from the current URL criteria.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setD(pickDraft(criteria));
      setCountyFilter("");
    }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  // The schools listings name, fetched the first time the dialog opens. On an error the
  // inputs stay free text.
  const schoolListId = useId();
  const [schools, setSchools] = useState<SchoolOptions | null>(null);
  const schoolsRequested = useRef(false);
  useEffect(() => {
    if (!open || schoolsRequested.current) return;
    schoolsRequested.current = true;
    fetch("/api/search/schools")
      .then((res) => (res.ok ? (res.json() as Promise<SchoolOptions>) : null))
      .then((options) => {
        if (options) setSchools(options);
      })
      .catch(() => {});
  }, [open]);
  const countyKey = normalizeCounty(countyFilter);
  const shownCounties = COUNTY_KEYS.filter((c) => c.key.includes(countyKey));
  const toggleCounty = (name: string, on: boolean) => {
    const next = new Set(d.counties ?? []);
    if (on) next.add(name);
    else next.delete(name);
    set("counties", parseCounties([...next]));
  };

  const apply = () => {
    // The location box's county opened checked (pickDraft). Left as the only one, the
    // search stays as typed; changed, it folds into `counties` (never both for one county).
    // Another place gives way to chosen counties, its map area too.
    const qCounty = explicitCountyQuery(criteria.q);
    const place = qCounty
      ? d.counties?.length === 1 && d.counties[0] === qCounty
        ? { counties: undefined }
        : { q: undefined }
      : d.counties?.length && criteria.q
        ? { q: undefined, bounds: undefined }
        : {};
    // The dialog writes acres; a legacy min lot size is replaced, not kept beside it.
    update({ ...d, ...place, kw: d.kw?.trim() || undefined, minLotSqft: undefined });
    onClose();
  };

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
          <Button onClick={apply}>Show results</Button>
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
        {allowsPriceReduced(criteria.mode) && (
          <Checkbox
            label="Price reduced"
            checked={!!d.priceReduced}
            onChange={(e) => set("priceReduced", e.target.checked || undefined)}
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

        <Field label="Keywords" htmlFor="kw">
          <Input
            id="kw"
            type="text"
            maxLength={80}
            placeholder="e.g. barn, workshop, dock"
            value={d.kw ?? ""}
            onChange={(e) => set("kw", e.target.value || undefined)}
          />
        </Field>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">County</legend>
          <div className="flex items-center gap-3">
            <Input
              type="search"
              aria-label="Find a county"
              placeholder="Find a county"
              value={countyFilter}
              onChange={(e) => setCountyFilter(e.target.value)}
            />
            <p className="shrink-0 text-sm text-muted" aria-live="polite">
              {d.counties?.length ?? 0} selected
            </p>
          </div>
          <div className="mt-3 grid max-h-56 grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-3">
            {shownCounties.map(({ name }) => (
              <Checkbox
                key={name}
                label={name}
                checked={d.counties?.includes(name) ?? false}
                onChange={(e) => toggleCounty(name, e.target.checked)}
              />
            ))}
            {!shownCounties.length && (
              <p className="text-sm text-muted">No Georgia county matches.</p>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">Schools</legend>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {SCHOOL_FIELDS.map(([level, label]) => (
              <Field key={level} label={label} htmlFor={`school-${level}`}>
                <Input
                  id={`school-${level}`}
                  type="text"
                  maxLength={100}
                  list={`${schoolListId}-${level}`}
                  aria-describedby={schools?.partial ? `${schoolListId}-updating` : undefined}
                  value={d[level] ?? ""}
                  onChange={(e) => set(level, e.target.value || undefined)}
                />
                <datalist id={`${schoolListId}-${level}`}>
                  {schools?.[level].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
            ))}
          </div>
          {schools?.partial && (
            <p id={`${schoolListId}-updating`} className="mt-3 text-sm text-muted" role="status">
              School data is still updating
            </p>
          )}
        </fieldset>

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
                  {v.toLocaleString("en-US")} sqft
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
                  {v.toLocaleString("en-US")} sqft
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Min acres" htmlFor="minAcres">
            <Select
              id="minAcres"
              value={d.minAcres ?? ""}
              onChange={(e) => set("minAcres", num(e.target.value))}
            >
              <option value="">Any</option>
              {acreOptions(d.minAcres).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}+
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max acres" htmlFor="maxAcres">
            <Select
              id="maxAcres"
              value={d.maxAcres ?? ""}
              onChange={(e) => set("maxAcres", num(e.target.value))}
            >
              <option value="">No max</option>
              {acreOptions(d.maxAcres).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="HOA" htmlFor="hoa">
            <Select
              id="hoa"
              value={d.hoa ?? ""}
              onChange={(e) => set("hoa", (e.target.value || undefined) as Draft["hoa"])}
            >
              <option value="">Any</option>
              <option value="yes">Has HOA</option>
              <option value="no">No HOA</option>
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
          <Field label="55+ communities" htmlFor="age55">
            <Select
              id="age55"
              value={d.age55 ?? ""}
              onChange={(e) => set("age55", (e.target.value || undefined) as Draft["age55"])}
            >
              <option value="">Include</option>
              <option value="exclude">Exclude</option>
              <option value="only">Only</option>
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
                aria-label={FEATURE_ARIA_LABELS[f]}
                aria-describedby={
                  bedOnMainUpdating && BED_ON_MAIN_FLAGS.includes(f) ? updatingId : undefined
                }
                checked={!!d[f]}
                onChange={(e) => set(f, e.target.checked || undefined)}
              />
            ))}
          </div>
          {bedOnMainUpdating && (
            <p id={updatingId} className="mt-3 text-sm text-muted" role="status">
              Bedroom-on-main data is still updating
            </p>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
