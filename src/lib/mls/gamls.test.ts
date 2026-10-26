import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { feedChanged, gamlsFilter, gamlsSource, liveStatusFilter } from "./gamls";

const LIVE =
  "StandardStatus eq 'Active' or StandardStatus eq 'Active Under Contract' or " +
  "StandardStatus eq 'Coming Soon' or StandardStatus eq 'Pending'";

const AREA =
  site.market.counties.map((c) => `CountyOrParish eq '${c}'`).join(" or ") +
  " or (CountyOrParish eq 'Barrow' and (City eq 'Braselton' or City eq 'Hoschton'))";

describe("liveStatusFilter", () => {
  it("chains the live statuses with `or` (no `in`)", () => {
    expect(liveStatusFilter()).toBe(LIVE);
  });
});

describe("gamlsFilter", () => {
  it("statewide with no office: live listings only", () => {
    expect(gamlsFilter({ MLS_GAMLS_SCOPE: "statewide" })).toBe(`(${LIVE})`);
  });

  it("defaults to statewide when unset or empty", () => {
    expect(gamlsFilter({})).toBe(`(${LIVE})`);
    expect(gamlsFilter({ MLS_GAMLS_SCOPE: "" })).toBe(`(${LIVE})`);
  });

  it("statewide with an office: that office's live listings (the office narrows)", () => {
    expect(gamlsFilter({ MLS_GAMLS_OFFICE_ID: " ADAM01 " })).toBe(
      `(ListOfficeMlsId eq 'ADAM01') and (${LIVE})`,
    );
  });

  it("area with no office: the firm's counties, plus Braselton and Hoschton in Barrow", () => {
    expect(gamlsFilter({ MLS_GAMLS_SCOPE: "area" })).toBe(`(${AREA}) and (${LIVE})`);
    expect(AREA).toContain("CountyOrParish eq 'Franklin'");
  });

  it("area with an office: also the office's listings outside the area (the office widens)", () => {
    expect(gamlsFilter({ MLS_GAMLS_SCOPE: " Area ", MLS_GAMLS_OFFICE_ID: "ADAM01" })).toBe(
      `(${AREA} or ListOfficeMlsId eq 'ADAM01') and (${LIVE})`,
    );
  });

  it("doubles single quotes in literals", () => {
    expect(gamlsFilter({ MLS_GAMLS_OFFICE_ID: "O'NEAL" })).toBe(
      `(ListOfficeMlsId eq 'O''NEAL') and (${LIVE})`,
    );
  });

  it("throws on any other scope, naming the variable and the allowed values", () => {
    expect(() => gamlsFilter({ MLS_GAMLS_SCOPE: "county" })).toThrow(
      /MLS_GAMLS_SCOPE.*"statewide".*"area"/,
    );
  });
});

describe("gamlsSource", () => {
  it("is live-only, with the live clause in its filter", () => {
    const { config } = gamlsSource({ MLS_GAMLS_DATASET: "gamls" });
    expect(config.liveOnly).toBe(true);
    expect(config.filter).toContain(LIVE);
  });
});

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
    expect(feedChanged({ ...live, filter: undefined }, live)).toBe(true);
  });

  it("is true when the scope changed", () => {
    const area = gamlsSource({ MLS_GAMLS_DATASET: "gamls", MLS_GAMLS_SCOPE: "area" }).config;
    expect(feedChanged(live, area)).toBe(true);
    expect(feedChanged(area, live)).toBe(true);
  });

  it("is true when liveOnly changed", () => {
    expect(feedChanged({ ...live, liveOnly: undefined }, live)).toBe(true);
    expect(feedChanged(live, { ...live, liveOnly: false })).toBe(true);
  });

  it("is false with no previous row", () => {
    expect(feedChanged(undefined, live)).toBe(false);
    expect(feedChanged(null, live)).toBe(false);
  });
});
