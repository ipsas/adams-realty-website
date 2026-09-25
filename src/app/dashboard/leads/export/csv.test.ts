import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvDateTime, csvRow, exportFilename } from "./csv";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Avery Thompson")).toBe("Avery Thompson");
    expect(csvCell("avery@example.com")).toBe("avery@example.com");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(true)).toBe("true");
  });

  it("renders null and undefined as empty cells", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("quotes cells with commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell("Decatur, GA")).toBe('"Decatur, GA"');
    expect(csvCell('The "blue" house')).toBe('"The ""blue"" house"');
    expect(csvCell("Line one\nLine two")).toBe('"Line one\nLine two"');
    expect(csvCell("Line one\r\nLine two")).toBe('"Line one\r\nLine two"');
  });

  it("quotes cells with leading or trailing whitespace so it survives", () => {
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell("padded ")).toBe('"padded "');
  });

  it.each(["=", "+", "-", "@"])("neutralizes text starting with %s", (ch) => {
    expect(csvCell(`${ch}cmd`)).toBe(`'${ch}cmd`);
  });

  it("neutralizes formulas an attacker would actually send", () => {
    expect(csvCell('=HYPERLINK("https://evil.example","Click")')).toBe(
      `"'=HYPERLINK(""https://evil.example"",""Click"")"`,
    );
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
    expect(csvCell("-2+3+cmd|' /C calc'!A0")).toBe("'-2+3+cmd|' /C calc'!A0");
    expect(csvCell("+1 (404) 555-0142")).toBe("'+1 (404) 555-0142");
  });

  it("neutralizes a leading tab or carriage return (quoting only what needs it)", () => {
    expect(csvCell("\t=1+1")).toBe("'\t=1+1");
    expect(csvCell("\r=1+1")).toBe('"\'\r=1+1"');
  });

  it("does not touch formula characters later in the text", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("555-0142")).toBe("555-0142");
    expect(csvCell("name@example.com")).toBe("name@example.com");
  });

  it("keeps real negative numbers as numbers", () => {
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("csvRow", () => {
  it("joins cells with commas and ends with CRLF", () => {
    expect(csvRow(["a", null, 2, "b,c", "=x"])).toBe(`a,,2,"b,c",'=x\r\n`);
  });

  it("exposes a UTF-8 byte order mark for Excel", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});

describe("csvDateTime", () => {
  it("formats in the given time zone, 24-hour", () => {
    // 2026-09-25 18:30 UTC = 2:30 PM EDT
    expect(csvDateTime(new Date("2026-09-25T18:30:00Z"), "America/New_York")).toBe(
      "2026-09-25 14:30",
    );
  });

  it("handles standard time and dates that cross midnight", () => {
    // 2026-12-01 03:15 UTC = Nov 30, 10:15 PM EST
    expect(csvDateTime(new Date("2026-12-01T03:15:00Z"), "America/New_York")).toBe(
      "2026-11-30 22:15",
    );
  });

  it("uses 00 for midnight, not 24", () => {
    expect(csvDateTime(new Date("2026-09-25T04:05:00Z"), "America/New_York")).toBe(
      "2026-09-25 00:05",
    );
  });

  it("is empty for missing dates", () => {
    expect(csvDateTime(null, "America/New_York")).toBe("");
  });
});

describe("exportFilename", () => {
  it("names the file by brand, filter and local date", () => {
    // 01:00 UTC on the 26th is still the 25th in Atlanta.
    expect(
      exportFilename("Adams Realty", "open", new Date("2026-09-26T01:00:00Z"), "America/New_York"),
    ).toBe("adams-realty-leads-open-2026-09-25.csv");
  });

  it("keeps the name filesystem- and header-safe", () => {
    expect(exportFilename('A&B "Homes"', "all", new Date("2026-09-25T12:00:00Z"), "UTC")).toBe(
      "a-b-homes-leads-all-2026-09-25.csv",
    );
  });
});
