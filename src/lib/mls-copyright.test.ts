import { describe, expect, it } from "vitest";
import {
  formatLastUpdated,
  mlsDisclaimer,
  sourceDisclaimer,
  sourceDisclaimers,
} from "./mls-copyright";

const SECTION_12F =
  "IDX information is provided exclusively for consumers' personal, non-commercial use, that it may not be used for any purpose other than to identify prospective properties consumers may be interested in purchasing, and that the data is deemed reliable but is not guaranteed accurate by GAMLS.";

const WORDING = `Georgia MLS. All rights reserved. ${SECTION_12F}`;

describe("mlsDisclaimer", () => {
  const now = new Date("2026-10-26T18:00:00Z");

  it("is GAMLS's notice with the current year and the last sync in Eastern time", () => {
    expect(mlsDisclaimer(new Date("2026-10-26T17:57:00Z"), now)).toBe(
      `© 2026 ${WORDING} Last updated Oct 26, 2026, 1:57 PM ET`,
    );
  });

  it("contains GAMLS R&R Art. III-2 Section 12 f word for word", () => {
    const out = mlsDisclaimer(new Date("2026-10-26T17:57:00Z"), now);
    expect(out).toContain(SECTION_12F);
    expect(out).not.toContain(["Information", "is deemed"].join(" "));
    expect(out).not.toContain("use and may not");
  });

  it("takes the year from the render time, never a fixed one", () => {
    expect(mlsDisclaimer("2026-12-31T12:00:00Z", new Date("2027-01-02T12:00:00Z"))).toMatch(
      /^© 2027 Georgia MLS\. .* Last updated Dec 31, 2026, 7:00 AM ET$/,
    );
    expect(mlsDisclaimer(null, now, undefined)).not.toContain("2021");
  });

  it("formats in America/New_York across daylight saving time", () => {
    // EST (UTC−5) in winter.
    expect(formatLastUpdated(new Date("2026-01-15T14:05:00Z"))).toBe("Jan 15, 2026, 9:05 AM ET");
    // EDT (UTC−4) in summer.
    expect(formatLastUpdated(new Date("2026-07-04T00:30:00Z"))).toBe("Jul 3, 2026, 8:30 PM ET");
  });

  it("falls back to the build time without a successful sync", () => {
    const build = "2026-10-20T15:00:00.000Z";
    for (const missing of [null, undefined, "", "not a date"]) {
      expect(mlsDisclaimer(missing, now, build)).toBe(
        `© 2026 ${WORDING} Last updated Oct 20, 2026, 11:00 AM ET`,
      );
    }
  });

  it("prefers the sync time to the build time", () => {
    expect(mlsDisclaimer("2026-10-26T17:57:00Z", now, "2026-10-20T15:00:00.000Z")).toContain(
      "Last updated Oct 26, 2026, 1:57 PM ET",
    );
  });

  it("leaves out the time when there is neither", () => {
    expect(mlsDisclaimer(null, now, undefined)).toBe(`© 2026 ${WORDING}`);
  });
});

describe("sourceDisclaimer", () => {
  const now = new Date("2026-10-26T18:00:00Z");
  const at = new Date("2026-10-26T17:57:00Z");

  it("computes Georgia MLS's and never shows its stored text", () => {
    const stale = "© 2021 Georgia MLS. stored, never shown";
    expect(sourceDisclaimer({ slug: "gamls", disclaimer: stale, lastSyncedAt: at }, now)).toBe(
      `© 2026 ${WORDING} Last updated Oct 26, 2026, 1:57 PM ET`,
    );
  });

  it("shows other sources' stored text as is", () => {
    expect(
      sourceDisclaimer({ slug: "other", disclaimer: "Other MLS text.", lastSyncedAt: at }, now),
    ).toBe("Other MLS text.");
    expect(sourceDisclaimer({ slug: "manual", disclaimer: null, lastSyncedAt: null }, now)).toBe(
      null,
    );
  });
});

describe("sourceDisclaimers", () => {
  const now = new Date("2026-10-26T18:00:00Z");
  const at = new Date("2026-10-26T17:57:00Z");
  const gamls = { slug: "gamls", disclaimer: "stored, never shown", lastSyncedAt: at };

  it("puts Georgia MLS's computed notice first, drops empty ones and dedupes", () => {
    expect(
      sourceDisclaimers(
        [
          { slug: "a-mls", disclaimer: "Other MLS text.", lastSyncedAt: null },
          { slug: "b-mls", disclaimer: "Other MLS text.", lastSyncedAt: null },
          { slug: "manual", disclaimer: null, lastSyncedAt: null },
          { slug: "blank", disclaimer: "", lastSyncedAt: null },
          gamls,
        ],
        now,
      ),
    ).toEqual([`© 2026 ${WORDING} Last updated Oct 26, 2026, 1:57 PM ET`, "Other MLS text."]);
  });

  it("shows nothing for no sources, and no Georgia MLS notice without the gamls source", () => {
    expect(sourceDisclaimers([], now)).toEqual([]);
    expect(
      sourceDisclaimers(
        [{ slug: "other", disclaimer: "Other MLS text.", lastSyncedAt: null }],
        now,
      ),
    ).toEqual(["Other MLS text."]);
  });
});
