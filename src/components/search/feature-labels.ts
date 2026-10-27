import type { FeatureFlag } from "@/lib/search/params";

export const FEATURE_LABELS: Record<FeatureFlag, string> = {
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
  fireplace: "Fireplace",
  primaryOnMain: "Primary bedroom on main",
  bedOnMain: "Any bedroom on main level",
};

/** Accessible names where the visible label leaves out words people search by. */
export const FEATURE_ARIA_LABELS: Partial<Record<FeatureFlag, string>> = {
  primaryOnMain: "Primary bedroom on main (master bedroom on main floor)",
};
