import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PHONE_QUERY } from "./use-media-query";

/** Formatting-insensitive form of a media query list (Prettier may respace it). */
const normalize = (q: string) =>
  q
    .replace(/\s+/g, " ")
    .replace(/\s*([(),:])\s*/g, "$1")
    .trim();

describe("PHONE_QUERY", () => {
  it("is the exact query behind the `phone` variant in globals.css", () => {
    const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
    // Block form `@custom-variant phone { @media … { @slot } }` or shorthand `(@media …);`.
    const match =
      css.match(/@custom-variant\s+phone\s*\{\s*@media\s+([^{]+?)\s*\{/) ??
      css.match(/@custom-variant\s+phone\s*\(\s*@media\s+(.+?)\s*\)\s*;/);
    expect(match, "globals.css should define @custom-variant phone").not.toBeNull();
    expect(normalize(match![1])).toBe(normalize(PHONE_QUERY));
  });
});
