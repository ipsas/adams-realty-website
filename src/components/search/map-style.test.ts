import { describe, expect, it } from "vitest";
import { DEFAULT_MAP_STYLE_URLS, pickMapStyleUrl } from "./map-style";

describe("pickMapStyleUrl", () => {
  it("uses OpenFreeMap positron and dark by default", () => {
    expect(pickMapStyleUrl("light", {})).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(pickMapStyleUrl("dark", {})).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(DEFAULT_MAP_STYLE_URLS.dark).toMatch(/styles\/dark$/);
  });

  it("uses each custom URL for its theme", () => {
    const custom = {
      light: "https://maps.example/light.json",
      dark: "https://maps.example/dark.json",
    };
    expect(pickMapStyleUrl("light", custom)).toBe(custom.light);
    expect(pickMapStyleUrl("dark", custom)).toBe(custom.dark);
  });

  it("keeps a custom light provider in dark rather than falling back to OpenFreeMap", () => {
    const custom = { light: "https://maps.example/light.json" };
    expect(pickMapStyleUrl("dark", custom)).toBe(custom.light);
    expect(pickMapStyleUrl("light", custom)).toBe(custom.light);
  });

  it("treats empty variables as unset", () => {
    expect(pickMapStyleUrl("light", { light: "", dark: "" })).toBe(DEFAULT_MAP_STYLE_URLS.light);
    expect(pickMapStyleUrl("dark", { light: "", dark: "" })).toBe(DEFAULT_MAP_STYLE_URLS.dark);
  });

  it("a custom dark URL alone leaves light on positron", () => {
    const custom = { dark: "https://maps.example/dark.json" };
    expect(pickMapStyleUrl("light", custom)).toBe(DEFAULT_MAP_STYLE_URLS.light);
    expect(pickMapStyleUrl("dark", custom)).toBe(custom.dark);
  });
});
