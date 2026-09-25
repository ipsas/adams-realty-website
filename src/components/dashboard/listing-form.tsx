"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import type { ListingFeatures } from "@/db/schema";
import { cn } from "@/lib/cn";
import { deleteListing, saveListing, type ListingFormState } from "@/server/actions/dashboard";
import { PhotoManager, type PhotoValue } from "./photo-manager";

export type ListingFormValues = {
  id?: string;
  status: string;
  transactionType: string;
  propertyType: string;
  listPrice?: number | null;
  closePrice?: number | null;
  closeDate?: string | null;
  listDate?: string | null;
  addressLine1?: string;
  unitNumber?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  county?: string | null;
  neighborhood?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  bedrooms?: number | null;
  bathroomsFull?: number | null;
  bathroomsHalf?: number | null;
  livingAreaSqft?: number | null;
  lotSizeSqft?: number | null;
  yearBuilt?: number | null;
  garageSpaces?: number | null;
  hoaFee?: number | null;
  taxAnnualAmount?: number | null;
  headline?: string | null;
  description?: string | null;
  virtualTourUrl?: string | null;
  photos?: PhotoValue[];
  features?: ListingFeatures;
  listAgentId?: string | null;
  hasPool?: boolean;
  isWaterfront?: boolean;
  hasView?: boolean;
  hasBasement?: boolean;
  isNewConstruction?: boolean;
  isFeatured?: boolean;
};

const STATUSES = [
  ["coming_soon", "Coming soon"],
  ["active", "Active"],
  ["active_under_contract", "Under contract"],
  ["pending", "Pending"],
  ["closed", "Sold / closed"],
  ["withdrawn", "Withdrawn"],
  ["expired", "Expired"],
  ["canceled", "Canceled"],
];
/** Saving with one of these takes the listing's upcoming open houses off the site. */
const OFF_MARKET = new Set(["closed", "withdrawn", "expired", "canceled"]);
const TYPES = [
  ["single_family", "Single-family"],
  ["condo", "Condo"],
  ["townhouse", "Townhome"],
  ["multi_family", "Multi-family"],
  ["manufactured", "Manufactured"],
  ["land", "Land"],
  ["farm_ranch", "Farm / ranch"],
  ["other", "Other"],
];

/** Editable feature groups, in the order the property page shows them. */
const FEATURE_FIELDS: [keyof ListingFeatures, string, string][] = [
  ["interior", "Interior", "Hardwood floors, Walk-in closet, Fireplace"],
  ["exterior", "Exterior", "Covered patio, Fenced yard"],
  ["appliances", "Appliances", "Gas range, Dishwasher, Refrigerator"],
  ["parking", "Parking", "Garage (2 car), Driveway"],
  ["community", "Community", "Pool, Clubhouse, Sidewalks"],
];
const FEATURE_KEYS = new Set<string>(FEATURE_FIELDS.map(([k]) => k));
const OTHER_FEATURE_LABELS: Partial<Record<keyof ListingFeatures, string>> = {
  heating: "heating",
  cooling: "cooling",
  flooring: "flooring",
  utilities: "utilities",
  view: "view",
  construction: "construction",
  lot: "lot",
};

// Inputs stay at 16px on phones so iOS doesn't zoom into them.
const control = "text-base sm:text-sm";

export function ListingForm({
  values,
  agents,
  canFeature,
  canAssignAgent,
  canDelete,
  upcomingOpenHouses = 0,
}: {
  values: ListingFormValues;
  agents: { id: string; name: string }[];
  canFeature: boolean;
  canAssignAgent: boolean;
  canDelete: boolean;
  /** Open houses that haven't ended yet, so the form can warn before a status change cancels them. */
  upcomingOpenHouses?: number;
}) {
  const [state, dispatch, pending] = useActionState<ListingFormState, FormData>(
    async (prev, data) => {
      const next = await saveListing(prev, data);
      // Keep the last save's stamp through failed attempts so fields aren't remounted.
      return { ...next, savedAt: next.savedAt ?? prev.savedAt };
    },
    { ok: false },
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Take the user to the first field that needs fixing. Composite controls
  // (the photo manager) mark their focusable error message with data-invalid.
  useEffect(() => {
    if (!state.errors) return;
    const first = formRef.current?.querySelector<HTMLElement>(
      "[aria-invalid=true], [data-invalid]",
    );
    first?.focus();
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  return (
    <form
      ref={formRef}
      className="space-y-8"
      noValidate
      // Submitting through a transition (instead of `action=`) keeps what the
      // user typed when validation fails; React would otherwise reset the form.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
    >
      {values.id && <input type="hidden" name="id" value={values.id} />}

      {/* Remount after a save so fields (and the photo list) show the stored, normalized values. */}
      <ListingFields
        key={state.savedAt ?? 0}
        values={values}
        errors={state.errors ?? {}}
        agents={agents}
        canFeature={canFeature}
        canAssignAgent={canAssignAgent}
        upcomingOpenHouses={upcomingOpenHouses}
      />

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : values.id ? "Save changes" : "Create listing"}
        </Button>
        {state.message && !pending && (
          <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
        )}
        {values.id && canDelete && (
          <Button
            variant="ghost"
            className="ml-auto text-clay-600 hover:bg-clay-50"
            onClick={() => {
              if (
                confirm("Delete this listing permanently? Saved homes and history will be removed.")
              )
                void deleteListing(values.id!);
            }}
          >
            Delete listing
          </Button>
        )}
      </div>
    </form>
  );
}

function ListingFields({
  values: v,
  errors: e,
  agents,
  canFeature,
  canAssignAgent,
  upcomingOpenHouses,
}: {
  values: ListingFormValues;
  errors: Partial<Record<string, string>>;
  agents: { id: string; name: string }[];
  canFeature: boolean;
  canAssignAgent: boolean;
  upcomingOpenHouses: number;
}) {
  const [status, setStatus] = useState(v.status);
  const cancelsOpenHouses = upcomingOpenHouses > 0 && OFF_MARKET.has(status);
  const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const invalid = (name: string) => (e[name] ? true : undefined);
  const features = v.features ?? {};
  const otherFeatures = (Object.keys(features) as (keyof ListingFeatures)[]).filter(
    (k) => !FEATURE_KEYS.has(k) && features[k]?.length && OTHER_FEATURE_LABELS[k],
  );

  return (
    <>
      <Group title="Status & price">
        <Field
          label="Status"
          htmlFor="status"
          hint={
            cancelsOpenHouses && (
              <span className="font-medium text-clay-600">
                Saving takes{" "}
                {upcomingOpenHouses === 1
                  ? "the upcoming open house"
                  : `the ${upcomingOpenHouses} upcoming open houses`}{" "}
                off the site.
              </span>
            )
          }
        >
          <Select
            id="status"
            name="status"
            defaultValue={v.status}
            onChange={(e) => setStatus(e.target.value)}
            className={control}
          >
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Listing type" htmlFor="transactionType">
          <Select
            id="transactionType"
            name="transactionType"
            defaultValue={v.transactionType}
            className={control}
          >
            <option value="sale">For sale</option>
            <option value="rent">For rent</option>
          </Select>
        </Field>
        <Field label="Property type" htmlFor="propertyType">
          <Select
            id="propertyType"
            name="propertyType"
            defaultValue={v.propertyType}
            className={control}
          >
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="List price ($)"
          htmlFor="listPrice"
          error={e.listPrice}
          hint="Monthly rent for rentals."
        >
          <Input
            id="listPrice"
            name="listPrice"
            type="number"
            min={1}
            inputMode="numeric"
            defaultValue={val(v.listPrice)}
            aria-invalid={invalid("listPrice")}
            required
            className={control}
          />
        </Field>
        <Field label="List date" htmlFor="listDate">
          <Input
            id="listDate"
            name="listDate"
            type="date"
            defaultValue={v.listDate ?? ""}
            className={control}
          />
        </Field>
        <Field label="Close price (if sold)" htmlFor="closePrice" error={e.closePrice}>
          <Input
            id="closePrice"
            name="closePrice"
            type="number"
            inputMode="numeric"
            defaultValue={val(v.closePrice)}
            aria-invalid={invalid("closePrice")}
            className={control}
          />
        </Field>
        <Field label="Close date" htmlFor="closeDate">
          <Input
            id="closeDate"
            name="closeDate"
            type="date"
            defaultValue={v.closeDate ?? ""}
            className={control}
          />
        </Field>
        {canAssignAgent && (
          <Field label="Listing agent" htmlFor="listAgentId">
            <Select
              id="listAgentId"
              name="listAgentId"
              defaultValue={v.listAgentId ?? ""}
              className={control}
            >
              <option value="">— None —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Group>

      <Group title="Address">
        <Field
          label="Street address"
          htmlFor="addressLine1"
          error={e.addressLine1}
          className="sm:col-span-2"
        >
          <Input
            id="addressLine1"
            name="addressLine1"
            defaultValue={v.addressLine1}
            aria-invalid={invalid("addressLine1")}
            required
            autoComplete="off"
            className={control}
          />
        </Field>
        <Field label="Unit" htmlFor="unitNumber">
          <Input
            id="unitNumber"
            name="unitNumber"
            defaultValue={v.unitNumber ?? ""}
            className={control}
          />
        </Field>
        <Field label="City" htmlFor="city" error={e.city}>
          <Input
            id="city"
            name="city"
            defaultValue={v.city}
            aria-invalid={invalid("city")}
            required
            className={control}
          />
        </Field>
        <Field label="State" htmlFor="state" error={e.state}>
          <Input
            id="state"
            name="state"
            defaultValue={v.state ?? "GA"}
            maxLength={2}
            aria-invalid={invalid("state")}
            required
            className={control}
          />
        </Field>
        <Field label="ZIP" htmlFor="postalCode" error={e.postalCode}>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={v.postalCode}
            inputMode="numeric"
            aria-invalid={invalid("postalCode")}
            required
            className={control}
          />
        </Field>
        <Field label="Neighborhood / subdivision" htmlFor="neighborhood">
          <Input
            id="neighborhood"
            name="neighborhood"
            defaultValue={v.neighborhood ?? ""}
            className={control}
          />
        </Field>
        <Field label="County" htmlFor="county">
          <Input id="county" name="county" defaultValue={v.county ?? ""} className={control} />
        </Field>
        <Field
          label="Latitude"
          htmlFor="latitude"
          error={e.latitude}
          hint="Leave blank to look it up from the address."
        >
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="any"
            inputMode="decimal"
            defaultValue={val(v.latitude)}
            aria-invalid={invalid("latitude")}
            className={control}
          />
        </Field>
        <Field label="Longitude" htmlFor="longitude" error={e.longitude}>
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="any"
            inputMode="decimal"
            defaultValue={val(v.longitude)}
            aria-invalid={invalid("longitude")}
            className={control}
          />
        </Field>
      </Group>

      <Group title="Details">
        {(
          [
            ["bedrooms", "Bedrooms", v.bedrooms],
            ["bathroomsFull", "Full baths", v.bathroomsFull],
            ["bathroomsHalf", "Half baths", v.bathroomsHalf],
            ["livingAreaSqft", "Living area (sq ft)", v.livingAreaSqft],
            ["lotSizeSqft", "Lot size (sq ft)", v.lotSizeSqft],
            ["yearBuilt", "Year built", v.yearBuilt],
            ["garageSpaces", "Garage spaces", v.garageSpaces],
            ["hoaFee", "HOA ($/month)", v.hoaFee],
            ["taxAnnualAmount", "Annual property tax ($)", v.taxAnnualAmount],
          ] as const
        ).map(([name, label, value]) => (
          <Field key={name} label={label} htmlFor={name} error={e[name]}>
            <Input
              id={name}
              name={name}
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={val(value)}
              aria-invalid={invalid(name)}
              className={control}
            />
          </Field>
        ))}
        <div className="flex flex-wrap gap-x-6 gap-y-3 sm:col-span-3">
          <Checkbox name="hasPool" label="Private pool" defaultChecked={v.hasPool} />
          <Checkbox name="isWaterfront" label="Waterfront" defaultChecked={v.isWaterfront} />
          <Checkbox name="hasView" label="View" defaultChecked={v.hasView} />
          <Checkbox name="hasBasement" label="Basement" defaultChecked={v.hasBasement} />
          <Checkbox
            name="isNewConstruction"
            label="New construction"
            defaultChecked={v.isNewConstruction}
          />
          {canFeature && (
            <Checkbox name="isFeatured" label="Feature on homepage" defaultChecked={v.isFeatured} />
          )}
        </div>
      </Group>

      <Group
        title="Features"
        description={
          <>
            Separate items with commas. They appear under Features on the property page.
            {otherFeatures.length > 0 &&
              ` Details already on file for ${listPhrase(otherFeatures.map((k) => OTHER_FEATURE_LABELS[k]!))} are kept as they are.`}
          </>
        }
        className="sm:grid-cols-2"
      >
        {FEATURE_FIELDS.map(([key, label, example], i) => {
          const name = `features_${key}`;
          return (
            <Field
              key={key}
              label={label}
              htmlFor={name}
              error={e[name]}
              className={cn(i === FEATURE_FIELDS.length - 1 && "sm:col-span-2")}
            >
              <Textarea
                id={name}
                name={name}
                rows={2}
                defaultValue={(features[key] ?? []).join(", ")}
                placeholder={`e.g. ${example}`}
                aria-invalid={invalid(name)}
                className={cn(control, "min-h-0 resize-y")}
              />
            </Field>
          );
        })}
      </Group>

      <Group
        title="Photos"
        description="The first photo is the cover on listing cards, search results and shares."
        className="sm:grid-cols-1"
      >
        <PhotoManager name="photos" initial={v.photos ?? []} error={e.photos} />
      </Group>

      <Group title="Marketing">
        <Field
          label="Headline"
          htmlFor="headline"
          className="sm:col-span-3"
          hint="Optional one-liner shown above the description."
        >
          <Input
            id="headline"
            name="headline"
            defaultValue={v.headline ?? ""}
            maxLength={140}
            className={control}
          />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-3">
          <Textarea
            id="description"
            name="description"
            rows={7}
            defaultValue={v.description ?? ""}
            className={control}
          />
        </Field>
        <Field
          label="3D / virtual tour URL"
          htmlFor="virtualTourUrl"
          className="sm:col-span-3"
          error={e.virtualTourUrl}
        >
          <Input
            id="virtualTourUrl"
            name="virtualTourUrl"
            type="url"
            inputMode="url"
            defaultValue={v.virtualTourUrl ?? ""}
            aria-invalid={invalid("virtualTourUrl")}
            className={control}
          />
        </Field>
      </Group>
    </>
  );
}

function listPhrase(items: string[]) {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Group({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <legend className="px-2 text-sm font-semibold text-ink">{title}</legend>
      {description && <p className="-mt-1 mb-4 text-sm text-muted">{description}</p>}
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-3", className)}>{children}</div>
    </fieldset>
  );
}
