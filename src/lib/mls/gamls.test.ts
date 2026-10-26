import { describe, expect, it } from "vitest";
import { feedChanged, gamlsSource } from "./gamls";

describe("feedChanged", () => {
  const live = gamlsSource({ MLS_GAMLS_DATASET: "gamls" }).config;

  it("is false when dataset and filter are unchanged", () => {
    expect(feedChanged({ ...live }, live)).toBe(false);
  });

  it("is true when the dataset (baseUrl) changed", () => {
    const test = gamlsSource({ MLS_GAMLS_DATASET: "test" }).config;
    expect(feedChanged(test, live)).toBe(true);
  });

  it("is true when the filter changed, including unset vs set", () => {
    const office = gamlsSource({
      MLS_GAMLS_DATASET: "gamls",
      MLS_GAMLS_OFFICE_ID: "ADAM01",
    }).config;
    expect(feedChanged(live, office)).toBe(true);
    expect(feedChanged(office, live)).toBe(true);
    expect(feedChanged(office, { ...office, filter: "ListOfficeMlsId eq 'X'" })).toBe(true);
  });

  it("is false with no previous row", () => {
    expect(feedChanged(undefined, live)).toBe(false);
    expect(feedChanged(null, live)).toBe(false);
  });
});
