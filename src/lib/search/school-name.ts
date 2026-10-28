/**
 * School names as the feed sends them ("NORTH HART", "North Hart ", "Other"):
 * one match key per school, placeholders told apart, and a display spelling.
 * Pure (no database), so the filters dialog can use it too.
 */

export const SCHOOL_LEVELS = ["elementary", "middle", "high"] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");

/** The match key: trimmed, single-spaced, lower case. */
export function schoolKey(s: string): string {
  return collapse(s).toLowerCase();
}

/** Keys a feed sends when it names no school. */
export const PLACEHOLDER_SCHOOL_KEYS = [
  "other",
  "none",
  "n/a",
  "na",
  "unknown",
  "see remarks",
  "",
] as const;

export function isPlaceholderSchool(s: string): boolean {
  return (PLACEHOLDER_SCHOOL_KEYS as readonly string[]).includes(schoolKey(s));
}

const ACRONYMS = new Set([
  "ES",
  "MS",
  "HS",
  "STEM",
  "STEAM",
  "IB",
  "KIPP",
  "YMCA",
  "II",
  "III",
  "IV",
]);
const EXCEPTIONS: Record<string, string> = {
  dekalb: "DeKalb",
  desoto: "DeSoto",
  lagrange: "LaGrange",
};

const upperFirst = (s: string) => s.replace(/[a-z]/, (ch) => ch.toUpperCase());

/** One word (or a part after "-" or "/"), lower case in, display case out. */
function formatWord(word: string): string {
  const core = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (!core) return word;
  const at = word.indexOf(core);
  const fix = (out: string) => word.slice(0, at) + out + word.slice(at + core.length);
  if (ACRONYMS.has(core.toUpperCase())) return fix(core.toUpperCase());
  if (EXCEPTIONS[core]) return fix(EXCEPTIONS[core]);
  const mc = /^mc([a-z])(.*)$/.exec(core);
  if (mc) return fix(`Mc${mc[1].toUpperCase()}${mc[2]}`);
  const o = /^o'([a-z])(.*)$/.exec(core);
  if (o) return fix(`O'${o[1].toUpperCase()}${o[2]}`);
  return fix(upperFirst(core));
}

/**
 * A school name for display: single-spaced; an all upper or all lower case name
 * is title-cased ("NORTH HART" → "North Hart", "MCEVER ES" → "McEver ES",
 * "k-8" → "K-8"). A mixed-case name is kept as the feed spells it ("DeKalb").
 */
export function formatSchoolName(s: string): string {
  const text = collapse(s);
  if (text !== text.toUpperCase() && text !== text.toLowerCase()) return text;
  return text.toLowerCase().replace(/[^\s\-/]+/g, formatWord);
}
