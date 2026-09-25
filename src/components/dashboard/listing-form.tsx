"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { deleteListing, saveListing, type ListingFormState } from "@/server/actions/dashboard";

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
  photos?: string[];
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

export function ListingForm({
  values: v,
  agents,
  canFeature,
  canAssignAgent,
  canDelete,
}: {
  values: ListingFormValues;
  agents: { id: string; name: string }[];
  canFeature: boolean;
  canAssignAgent: boolean;
  canDelete: boolean;
}) {
  const [state, action, pending] = useActionState<ListingFormState, FormData>(saveListing, {
    ok: false,
  });
  const e = state.errors ?? {};
  const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

  return (
    <form action={action} className="space-y-8" noValidate>
      {v.id && <input type="hidden" name="id" value={v.id} />}

      <Group title="Status & price">
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={v.status}>
            {STATUSES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Listing type" htmlFor="transactionType">
          <Select id="transactionType" name="transactionType" defaultValue={v.transactionType}>
            <option value="sale">For sale</option>
            <option value="rent">For rent</option>
          </Select>
        </Field>
        <Field label="Property type" htmlFor="propertyType">
          <Select id="propertyType" name="propertyType" defaultValue={v.propertyType}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="List price ($; monthly for rentals)" htmlFor="listPrice" error={e.listPrice}>
          <Input
            id="listPrice"
            name="listPrice"
            type="number"
            min={1}
            defaultValue={val(v.listPrice)}
            required
          />
        </Field>
        <Field label="List date" htmlFor="listDate">
          <Input id="listDate" name="listDate" type="date" defaultValue={v.listDate ?? ""} />
        </Field>
        <Field label="Close price (if sold)" htmlFor="closePrice">
          <Input id="closePrice" name="closePrice" type="number" defaultValue={val(v.closePrice)} />
        </Field>
        <Field label="Close date" htmlFor="closeDate">
          <Input id="closeDate" name="closeDate" type="date" defaultValue={v.closeDate ?? ""} />
        </Field>
        {canAssignAgent && (
          <Field label="Listing agent" htmlFor="listAgentId">
            <Select id="listAgentId" name="listAgentId" defaultValue={v.listAgentId ?? ""}>
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
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Unit" htmlFor="unitNumber">
          <Input id="unitNumber" name="unitNumber" defaultValue={v.unitNumber ?? ""} />
        </Field>
        <Field label="City" htmlFor="city" error={e.city}>
          <Input id="city" name="city" defaultValue={v.city} required />
        </Field>
        <Field label="State" htmlFor="state" error={e.state}>
          <Input id="state" name="state" defaultValue={v.state ?? "GA"} maxLength={2} required />
        </Field>
        <Field label="ZIP" htmlFor="postalCode" error={e.postalCode}>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={v.postalCode}
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Neighborhood / subdivision" htmlFor="neighborhood">
          <Input id="neighborhood" name="neighborhood" defaultValue={v.neighborhood ?? ""} />
        </Field>
        <Field label="County" htmlFor="county">
          <Input id="county" name="county" defaultValue={v.county ?? ""} />
        </Field>
        <Field
          label="Latitude"
          htmlFor="latitude"
          hint="Leave blank to look it up from the address."
        >
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="any"
            defaultValue={val(v.latitude)}
          />
        </Field>
        <Field label="Longitude" htmlFor="longitude">
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="any"
            defaultValue={val(v.longitude)}
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
            <Input id={name} name={name} type="number" min={0} defaultValue={val(value)} />
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

      <Group title="Marketing">
        <Field
          label="Headline"
          htmlFor="headline"
          className="sm:col-span-3"
          hint="Optional one-liner shown above the description."
        >
          <Input id="headline" name="headline" defaultValue={v.headline ?? ""} maxLength={140} />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-3">
          <Textarea
            id="description"
            name="description"
            rows={7}
            defaultValue={v.description ?? ""}
          />
        </Field>
        <Field
          label="Photo URLs"
          htmlFor="photos"
          className="sm:col-span-3"
          hint="One https:// URL per line; the first is the cover photo. (Direct uploads come with object storage.)"
        >
          <Textarea
            id="photos"
            name="photos"
            rows={5}
            defaultValue={(v.photos ?? []).join("\n")}
            className="font-mono text-xs"
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
            defaultValue={v.virtualTourUrl ?? ""}
          />
        </Field>
      </Group>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : v.id ? "Save changes" : "Create listing"}
        </Button>
        {state.message && (
          <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
        )}
        {v.id && canDelete && (
          <Button
            variant="ghost"
            className="ml-auto text-clay-600 hover:bg-clay-50"
            onClick={() => {
              if (
                confirm("Delete this listing permanently? Saved homes and history will be removed.")
              )
                void deleteListing(v.id!);
            }}
          >
            Delete listing
          </Button>
        )}
      </div>
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-3xl border border-line bg-surface p-6">
      <legend className="px-2 text-sm font-semibold text-ink">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}
