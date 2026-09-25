/**
 * CSV building for the leads export. RFC 4180 quoting, CRLF rows, and
 * formula-injection protection: a text cell starting with = + - @ (or a tab or
 * carriage return) is prefixed with an apostrophe so Excel, Sheets and Numbers
 * show it as text instead of running it (OWASP "CSV Injection").
 */

/** Makes Excel read the file as UTF-8, so names like "José" survive. */
export const CSV_BOM = "﻿";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Only text can smuggle a formula; a real number like -5 stays a number.
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

/** "2026-09-25 14:30" in `timeZone` — sortable, and spreadsheets parse it as a date. */
export function csvDateTime(d: Date | null | undefined, timeZone: string): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** "adams-realty-leads-open-2026-09-25.csv" (date in `timeZone`). */
export function exportFilename(brand: string, status: string, now: Date, timeZone: string): string {
  const slug = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const day = csvDateTime(now, timeZone).slice(0, 10);
  return `${[slug(brand), "leads", slug(status)].filter(Boolean).join("-")}-${day}.csv`;
}
