import { describe, expect, it } from "vitest";
import { listings } from "@/db/schema";
import {
  allowedPhotos,
  canShowDetails,
  IDX_HIDDEN_STATUSES,
  isIdxHidden,
  PRIMARY_PHOTO_ONLY_STATUSES,
  primaryPhotoOnly,
} from "./visibility";

// Georgia MLS IDX display rules (IDX agreement Exhibit A §§16-17, Exhibit C),
// for every status a listing can have, from the feed and entered by hand (the
// firm hides its own listings in the hidden statuses too).
const STATUSES = listings.status.enumValues;
const PHOTOS = ["primary.jpg", "second.jpg", "third.jpg"];

describe("Georgia MLS display rules", () => {
  it("hide Coming Soon, Withdrawn (and On Hold), Expired and Canceled listings", () => {
    const hidden = STATUSES.filter((status) => isIdxHidden({ status }));
    expect(hidden.sort()).toEqual(["canceled", "coming_soon", "expired", "withdrawn"]);
    expect([...IDX_HIDDEN_STATUSES].sort()).toEqual(hidden.sort());
  });

  it("hide the firm's own manual listings in those statuses too", () => {
    for (const status of STATUSES) {
      const hidden = (IDX_HIDDEN_STATUSES as readonly string[]).includes(status);
      const l = { fromFeed: false, status, removedAt: null };
      expect(isIdxHidden(l), status).toBe(hidden);
      expect(canShowDetails(l), status).toBe(!hidden);
      expect(allowedPhotos(l, PHOTOS), status).toEqual(hidden ? [] : PHOTOS);
    }
  });

  it("keep every photo of the firm's own visible listings, sold ones included", () => {
    for (const status of ["active", "active_under_contract", "pending", "closed"]) {
      expect(primaryPhotoOnly({ fromFeed: false, status }), status).toBe(false);
      expect(allowedPhotos({ fromFeed: false, status }, PHOTOS), status).toEqual(PHOTOS);
    }
  });

  it("show every photo of live feed listings, under contract and pending included", () => {
    for (const status of ["active", "active_under_contract", "pending"]) {
      expect(canShowDetails({ fromFeed: true, status, removedAt: null })).toBe(true);
      expect(allowedPhotos({ fromFeed: true, status, removedAt: null }, PHOTOS)).toEqual(PHOTOS);
    }
  });

  it("show sold feed listings with their primary photo only", () => {
    const sold = { fromFeed: true, status: "closed", removedAt: null };
    expect(canShowDetails(sold)).toBe(true);
    expect(primaryPhotoOnly(sold)).toBe(true);
    expect(allowedPhotos(sold, PHOTOS)).toEqual(["primary.jpg"]);
    expect(allowedPhotos(sold, [])).toEqual([]);
  });

  it("show nothing of a hidden listing, photos included, from the feed or not", () => {
    for (const status of IDX_HIDDEN_STATUSES) {
      for (const fromFeed of [true, false]) {
        const l = { fromFeed, status, removedAt: null };
        expect(canShowDetails(l), `${status} fromFeed=${fromFeed}`).toBe(false);
        expect(allowedPhotos(l, PHOTOS), `${status} fromFeed=${fromFeed}`).toEqual([]);
      }
    }
  });

  it("show nothing of a feed listing that left the feed, but keep the firm's removed pages", () => {
    const removedAt = new Date("2026-09-01T00:00:00Z");
    expect(canShowDetails({ fromFeed: true, status: "active", removedAt })).toBe(false);
    expect(allowedPhotos({ fromFeed: true, status: "active", removedAt }, PHOTOS)).toEqual([]);
    expect(canShowDetails({ fromFeed: false, status: "active", removedAt })).toBe(true);
  });

  it("list every off-market status whose secondary photos are excluded", () => {
    expect([...PRIMARY_PHOTO_ONLY_STATUSES].sort()).toEqual([
      "canceled",
      "closed",
      "expired",
      "withdrawn",
    ]);
  });
});
