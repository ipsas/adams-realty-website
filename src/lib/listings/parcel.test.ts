import { describe, expect, it } from "vitest";
import { displayParcel } from "./parcel";
import { IDX_HIDDEN_STATUSES } from "./visibility";

const live = { fromFeed: true, status: "active", removedAt: null, parcelNumber: "046 023A" };

describe("displayParcel", () => {
  it("shows the parcel number as stored, trimmed", () => {
    expect(displayParcel(live)).toBe("046 023A");
    expect(displayParcel({ ...live, parcelNumber: " R12-0034-01 " })).toBe("R12-0034-01");
    expect(displayParcel({ ...live, fromFeed: false, status: "closed" })).toBe("046 023A");
  });

  it("hides it when missing or blank", () => {
    for (const parcelNumber of [null, "", "   "]) {
      expect(displayParcel({ ...live, parcelNumber }), String(parcelNumber)).toBeNull();
    }
  });

  // Georgia MLS display rules: expired, withdrawn (and On Hold), canceled and
  // coming-soon listings show no details, from the feed or entered by hand.
  it("hides it for listings whose details the rules hide", () => {
    for (const status of IDX_HIDDEN_STATUSES) {
      for (const fromFeed of [true, false]) {
        expect(displayParcel({ ...live, status, fromFeed }), `${status} ${fromFeed}`).toBeNull();
      }
    }
    expect(displayParcel({ ...live, removedAt: new Date("2026-10-01") })).toBeNull();
  });
});
