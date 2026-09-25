import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Theme guard (ARCHITECTURE.md "Themes"). Class strings in src/ must stay dark-safe:
 *
 * - Overlays on photos, maps and the lightbox use `shade` (never redefined), not `ink`
 *   (which turns light in dark mode). A faint hover tint such as `hover:bg-ink/5` is fine:
 *   it should follow the theme.
 * - Labels on a solid `bg-ink` use `text-on-ink`, not `text-white`.
 * - Chips and buttons on photos use `bg-surface`, not `bg-white`, except the few that must
 *   stay white in both themes (ALLOW_WHITE).
 * - The primary fill is `bg-primary`: `bg-brand-700` is not redefined, so it would stay
 *   the light theme's green on the dark canvas.
 * - No hex colours in arbitrary classes (`bg-[#eef0ec]`); add a token instead.
 */

type Violation = { file: string; rule: string; classes: string };

/** Solid (or 90–95% opaque) white fills that are white in both themes on purpose. */
const ALLOW_WHITE: { file: string; classes: RegExp }[] = [
  // The switch knob.
  {
    file: "src/components/account/account-forms.tsx",
    classes: /\bsize-5\.5 rounded-full bg-white\b/,
  },
  // Carousel dots on photos.
  {
    file: "src/components/listings/listing-card.tsx",
    classes: /\bsize-1\.5 rounded-full bg-white\b/,
  },
  // The inverse button (white on brand panels, with text-shade).
  { file: "src/components/ui/button.tsx", classes: /^bg-white text-shade\b/ },
];

/** String literals and template-literal chunks that look like class lists. */
function classStrings(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([^`]*)`/g)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (/[a-z]-/.test(s)) out.push(s);
  }
  return out;
}

/** "hover:bg-ink/40" -> "bg-ink/40" (variants stripped; brackets respected). */
function utility(cls: string) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] === "[") depth++;
    else if (cls[i] === "]") depth--;
    else if (cls[i] === ":" && depth === 0) cut = i + 1;
  }
  return cls.slice(cut).replace(/^!/, "");
}

function themeViolations(source: string, file: string): Violation[] {
  const found: Violation[] = [];
  for (const s of classStrings(source)) {
    const classes = s.split(/\s+/).filter(Boolean);
    const utils = classes.map(utility);
    const add = (rule: string) => found.push({ file, rule, classes: s.trim() });

    for (const u of utils) {
      const inkAlpha = u.match(/^bg-ink\/(\d+)$/);
      if (inkAlpha && Number(inkAlpha[1]) >= 20) add(`${u}: overlays use bg-shade/NN`);
      if (/^(from|via|to)-ink(\/|$)/.test(u)) add(`${u}: gradients over photos use *-shade`);
      if (u === "bg-brand-700") add(`${u}: the primary fill is bg-primary`);
      if (/-\[#[0-9a-fA-F]{3,8}\]/.test(u)) add(`${u}: use a theme token, not a hex colour`);
    }
    if (utils.includes("bg-ink") && utils.includes("text-white")) {
      add("text-white on bg-ink: use text-on-ink");
    }
    if (utils.some((u) => /^bg-white(\/(9\d|100))?$/.test(u))) {
      const allowed = ALLOW_WHITE.some((a) => a.file === file && a.classes.test(s.trim()));
      if (!allowed) add("bg-white: use bg-surface (or add a reasoned ALLOW_WHITE entry)");
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("theme guard", () => {
  const root = process.cwd();
  const files = sourceFiles(join(root, "src")).map((p) => relative(root, p).replaceAll("\\", "/"));

  it("scans the app's components and pages", () => {
    expect(files).toContain("src/components/ui/button.tsx");
    expect(files).toContain("src/app/(site)/page.tsx");
    expect(files.length).toBeGreaterThan(100);
  });

  it("every class string in src/ is dark-safe", () => {
    const all = files.flatMap((f) => themeViolations(readFileSync(join(root, f), "utf8"), f));
    expect(all).toEqual([]);
  });

  it("every ALLOW_WHITE entry still matches something (no stale allowances)", () => {
    for (const a of ALLOW_WHITE) {
      const hit = classStrings(readFileSync(join(root, a.file), "utf8")).some((s) =>
        a.classes.test(s.trim()),
      );
      expect(hit, `${a.file} ${a.classes}`).toBe(true);
    }
  });

  it("the plan's deliberate keeps are still in the source and pass", () => {
    // save-button's faint hover tint follows the theme on purpose (review correction 10).
    const save = "src/components/listings/save-button.tsx";
    const source = readFileSync(join(root, save), "utf8");
    expect(source).toContain("hover:bg-ink/5");
    expect(themeViolations(source, save)).toEqual([]);
  });

  describe("catches each mistake", () => {
    const check = (src: string, file = "src/x.tsx") =>
      themeViolations(src, file).map((v) => v.rule);

    it("ink overlays and gradients", () => {
      expect(check(`<div className="absolute inset-0 bg-ink/30" />`)).toHaveLength(1);
      expect(check(`cn("group", "hover:bg-ink/40")`)).toHaveLength(1);
      expect(check(`"bg-gradient-to-t from-ink/80 via-ink/10 to-transparent"`)).toHaveLength(2);
      expect(check(`fallbackClassName="from-brand-800 to-ink"`)).toHaveLength(1);
      // Faint hover tints follow the theme on purpose.
      expect(check(`"rounded-full hover:bg-ink/5"`)).toEqual([]);
      expect(check(`"bg-gradient-to-t from-shade/80 via-shade/10"`)).toEqual([]);
    });

    it("white labels on a solid ink fill", () => {
      expect(check(`active ? "bg-ink text-white" : "text-ink-soft"`)).toHaveLength(1);
      expect(check(`"bg-ink text-on-ink hover:bg-ink-soft"`)).toEqual([]);
      // Translucent ink behind white text is an overlay, not an inversion.
      expect(check(`"bg-shade/80 text-white"`)).toEqual([]);
    });

    it("white chips outside the allowlist", () => {
      expect(check(`"rounded-full bg-white/95 text-ink"`)).toHaveLength(1);
      expect(check(`"bg-white text-ink hover:bg-white/90"`)).toHaveLength(1);
      expect(check(`"hover:bg-white"`)).toHaveLength(1);
      expect(check(`"bg-surface/95 hover:bg-surface"`)).toEqual([]);
      // Translucent white on photos and brand panels stays.
      expect(check(`"bg-white/15 hover:bg-white/10"`)).toEqual([]);
      expect(
        check(
          `"inline-block size-5.5 rounded-full bg-white shadow-sm"`,
          "src/components/account/account-forms.tsx",
        ),
      ).toEqual([]);
    });

    it("the old primary fill and hex arbitrary colours", () => {
      expect(check(`"bg-brand-700 text-white hover:bg-brand-800"`)).toHaveLength(1);
      expect(check(`"from-brand-600 via-brand-700 to-brand-900"`)).toEqual([]);
      expect(check(`"size-full bg-[#eef0ec]"`)).toHaveLength(1);
      expect(check(`"size-full bg-map"`)).toEqual([]);
    });
  });
});
