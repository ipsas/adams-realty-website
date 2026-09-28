import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
const { isBotUserAgent, parseViewRange } = await import("./views");

const now = new Date("2026-09-28T16:00:00Z"); // noon in Georgia

describe("parseViewRange", () => {
  it("defaults to the last 30 market days", () => {
    expect(parseViewRange({}, now)).toEqual({ from: "2026-08-30", to: "2026-09-28" });
  });

  it("takes valid dates, swaps a reversed range and ignores junk", () => {
    expect(parseViewRange({ from: "2026-09-01", to: "2026-09-10" }, now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
    });
    expect(parseViewRange({ from: "2026-09-10", to: "2026-09-01" }, now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
    });
    expect(parseViewRange({ from: "yesterday", to: "2026-13-45" }, now)).toEqual({
      from: "2026-08-30",
      to: "2026-09-28",
    });
  });

  it("caps a range at 366 days, both ends included", () => {
    expect(parseViewRange({ from: "2020-01-01", to: "2026-09-28" }, now).from).toBe("2025-09-28");
  });
});

describe("isBotUserAgent", () => {
  it("skips crawlers and HTTP libraries, counts browsers", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("python-requests/2.32")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(
      false,
    );
  });
});
