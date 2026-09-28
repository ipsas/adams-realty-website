import { describe, expect, it } from "vitest";
import { inquiryReply, withoutTour } from "./inquiry-reply";

describe("inquiryReply", () => {
  it("names the listing agent in the firm's area", () => {
    expect(inquiryReply({ type: "tour", name: "Sam Lee" }, "Andrea Anderegg", false)).toBe(
      "Request sent! Andrea will confirm your tour shortly.",
    );
    expect(inquiryReply({ type: "question", name: "Sam Lee" }, null, false)).toBe(
      "Thanks, Sam! An Adams agent will be in touch soon.",
    );
  });

  it("outside the firm's area, promises no tour and no local agent: the office answers", () => {
    const reply = inquiryReply({ type: "question", name: "Sam Lee" }, null, true);
    expect(reply).toBe(
      "Thanks, Sam! Your question went to the Adams Realty office, and we'll get back to you soon.",
    );
    expect(reply).not.toMatch(/tour|local/i);
  });
});

describe("withoutTour", () => {
  const tour = {
    type: "tour",
    name: "Sam",
    tourDate: "2026-10-01",
    tourTime: "10:00",
    tourType: "in_person" as const,
  };

  it("turns a tour request into a question where tours aren't offered", () => {
    expect(withoutTour(tour, false)).toEqual({
      type: "question",
      name: "Sam",
      tourDate: undefined,
      tourTime: undefined,
      tourType: undefined,
    });
  });

  it("keeps tours where they are offered, and questions as they are", () => {
    expect(withoutTour(tour, true)).toBe(tour);
    const question = { type: "question", name: "Sam" };
    expect(withoutTour(question, false)).toBe(question);
  });
});
