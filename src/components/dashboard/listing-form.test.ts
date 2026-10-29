import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/dashboard/listing-form.tsx", "utf8");

// A <Field ... error={e.NAME}> opening tag followed directly by its single control's opening tag.
const FIELD_CONTROL =
  /<Field\b[^>]*\berror=\{e\.(\w+)\}[^>]*>\s*<(Input|Textarea|Select|select)\b([^>]*)>/g;

describe("listing form", () => {
  const pairs = [...source.matchAll(FIELD_CONTROL)];

  it("finds the fields that show a server error", () => {
    expect(pairs.map((m) => m[1])).toContain("parcelNumber");
  });

  it("marks each such control aria-invalid from the same error", () => {
    for (const [, name, , attrs] of pairs) {
      expect(attrs, name).toContain(`aria-invalid={invalid("${name}")}`);
    }
  });
});
