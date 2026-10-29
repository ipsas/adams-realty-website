import { describe, expect, it } from "vitest";
import { cleanParcel } from "./parcel-value";

const INVISIBLE = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"];

describe("cleanParcel", () => {
  it("treats whitespace and invisible characters alone as empty", () => {
    for (const c of INVISIBLE) {
      const name = `U+${c.codePointAt(0)!.toString(16)}`;
      expect(cleanParcel(c), name).toBeNull();
      expect(cleanParcel(` \t${c}\n${c} `), name).toBeNull();
    }
    expect(cleanParcel(INVISIBLE.join(" \t\n"))).toBeNull();
    for (const s of ["", "   ", "\t\n"]) expect(cleanParcel(s)).toBeNull();
  });

  it("keeps a visible value as given, trimmed", () => {
    expect(cleanParcel(" 123-45 ")).toBe("123-45");
    expect(cleanParcel("\u200b12")).toBe("\u200b12");
  });

  it("is null for non-strings", () => {
    for (const v of [null, undefined, 123, {}, ["1"]]) expect(cleanParcel(v)).toBeNull();
  });
});
