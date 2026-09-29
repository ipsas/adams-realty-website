import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "@/lib/local-store";
import {
  isDetailPath,
  isListUrl,
  lastList,
  markReturn,
  readStamp,
  rememberList,
  RETURN_MARK_MAX_AGE_MS,
  takeReturn,
  withStamp,
} from "./return-nav";

function mapStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

const LEAD = "/dashboard/leads/5f0c9a2e-8a1b-4c3d-9e4f-0a1b2c3d4e5f";

describe("scopes", () => {
  it("knows each scope's list and detail pages", () => {
    expect(isListUrl("search", "/homes?q=Royston")).toBe(true);
    expect(isListUrl("search", "/homes/12-main-st")).toBe(false);
    expect(isDetailPath("search", "/homes/12-main-st")).toBe(true);
    expect(isListUrl("leads", "/dashboard/leads?status=all")).toBe(true);
    expect(isDetailPath("leads", LEAD)).toBe(true);
    expect(isDetailPath("leads", "/dashboard/leads/export")).toBe(false);
    expect(isDetailPath("listings", "/dashboard/listings/new")).toBe(true);
    expect(isListUrl("search", "//evil.example/homes")).toBe(false);
    expect(isListUrl("search", "https://evil.example/homes")).toBe(false);
  });
});

describe("markReturn / takeReturn", () => {
  it("hands the list URL to the detail page it opened, once", () => {
    const storage = mapStorage();
    markReturn("leads", "/dashboard/leads?status=new", LEAD, { storage, now: 0 });
    expect(takeReturn("leads", "/dashboard/leads/other", { storage, now: 1 })).toBeNull();
    expect(takeReturn("leads", LEAD, { storage, now: 1 })).toBe("/dashboard/leads?status=new");
    // Taken: a later visit from elsewhere doesn't inherit it.
    expect(takeReturn("leads", LEAD, { storage, now: 2 })).toBeNull();
  });

  it("ignores stale marks and links that aren't list → detail", () => {
    const storage = mapStorage();
    markReturn("search", "/homes?q=Royston", "/homes/a", { storage, now: 0 });
    expect(
      takeReturn("search", "/homes/a", { storage, now: RETURN_MARK_MAX_AGE_MS + 1 }),
    ).toBeNull();
    markReturn("search", "/saved", "/homes/a", { storage, now: 0 });
    expect(takeReturn("search", "/homes/a", { storage, now: 1 })).toBeNull();
    markReturn("search", "/homes", "/homes/a?x=1", { storage, now: 0 });
    expect(takeReturn("search", "/homes/a", { storage, now: 1 })).toBeNull();
  });

  it("keeps scopes apart", () => {
    const storage = mapStorage();
    markReturn("search", "/homes", "/homes/a", { storage, now: 0 });
    expect(takeReturn("leads", "/homes/a", { storage, now: 1 })).toBeNull();
    expect(takeReturn("search", "/homes/a", { storage, now: 1 })).toBe("/homes");
  });
});

describe("rememberList / lastList", () => {
  it("remembers only list URLs of the scope", () => {
    const storage = mapStorage();
    expect(lastList("leads", { storage })).toBeNull();
    rememberList("leads", "/dashboard/leads?status=all", { storage });
    rememberList("leads", "/dashboard/listings", { storage });
    expect(lastList("leads", { storage })).toBe("/dashboard/leads?status=all");
    storage.setItem("ar:list:leads", JSON.stringify("//evil.example"));
    expect(lastList("leads", { storage })).toBeNull();
  });
});

describe("history stamp", () => {
  it("adds the scope's list to the entry state and keeps Next's keys", () => {
    const state = withStamp("search", "/homes?q=Royston", { __NA: true, tree: [1] });
    expect(state).toMatchObject({ __NA: true, tree: [1] });
    expect(readStamp("search", state)).toBe("/homes?q=Royston");
    expect(readStamp("leads", state)).toBeNull();
    const both = withStamp("leads", "/dashboard/leads", state);
    expect(readStamp("search", both)).toBe("/homes?q=Royston");
    expect(readStamp("leads", both)).toBe("/dashboard/leads");
    expect(readStamp("search", null)).toBeNull();
    expect(readStamp("search", { __arReturn: { search: "https://evil.example" } })).toBeNull();
  });
});
