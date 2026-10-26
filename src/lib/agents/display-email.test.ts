import { describe, expect, it } from "vitest";
import { agentEmailOverrides } from "@/config/agent-email-overrides";
import { displayAgentEmail, displayAttributionEmail } from "./display-email";

const ANDREA_ID = "071b7b99-e3c2-47f8-9026-16ee79900bc5";
const FIXED = "contracts.adamsrealty@gmail.com";

describe("displayAgentEmail", () => {
  it("uses the override for the agent's row id", () => {
    expect(displayAgentEmail({ id: ANDREA_ID, email: "edited@example.com" })).toBe(FIXED);
  });

  it("uses the override for the MLS agent ID, case-insensitively", () => {
    expect(displayAgentEmail({ id: "other-id", mlsAgentId: "andereggaa", email: "x@y.com" })).toBe(
      FIXED,
    );
    expect(displayAgentEmail({ mlsAgentId: " ANDEREGGAA ", email: "x@y.com" })).toBe(FIXED);
  });

  it("passes other agents through", () => {
    expect(displayAgentEmail({ id: "other-id", mlsAgentId: "GA-777", email: "pat@example.com" })).toBe(
      "pat@example.com",
    );
    expect(displayAgentEmail({ id: null, mlsAgentId: null, email: null })).toBeNull();
  });

  it("gives every other agent their own stored email, lowercased", () => {
    for (const mlsAgentId of ["EC7733", "AM6239", "NORRISERIKA", "THOMPSONANIT"]) {
      expect(
        displayAgentEmail({ id: `id-${mlsAgentId}`, mlsAgentId, email: `${mlsAgentId}.Adams@Gmail.com` }),
      ).toBe(`${mlsAgentId.toLowerCase()}.adams@gmail.com`);
    }
  });

  it("lowercases and trims, and the override still wins for Andrea", () => {
    expect(displayAgentEmail({ id: "other-id", email: " Avery.adamsrealty@gmail.com " })).toBe(
      "avery.adamsrealty@gmail.com",
    );
    expect(displayAgentEmail({ id: ANDREA_ID, email: "Andrea.Adamsrealty@Gmail.com" })).toBe(FIXED);
  });
});

describe("agentEmailOverrides", () => {
  it("covers Andrea Anderegg only", () => {
    expect(agentEmailOverrides).toEqual([
      { agentId: ANDREA_ID, mlsAgentId: "ANDEREGGAA", email: FIXED },
    ]);
  });
});

describe("displayAttributionEmail", () => {
  it("replaces the feed's email (typo included) on her listings", () => {
    expect(
      displayAttributionEmail({
        attributionEmail: "andrea.adamsreatly@gmail.com",
        listAgentId: ANDREA_ID,
      }),
    ).toBe(FIXED);
    expect(
      displayAttributionEmail({
        attributionEmail: "andrea.adamsrealty@gmail.com",
        listAgentId: null,
        listAgentMlsId: "AnderEggAA",
      }),
    ).toBe(FIXED);
  });

  it("shows the override on her listing even when the feed sent no email", () => {
    expect(displayAttributionEmail({ attributionEmail: null, listAgentId: ANDREA_ID })).toBe(FIXED);
  });

  it("leaves other agents' listings untouched", () => {
    expect(
      displayAttributionEmail({
        attributionEmail: "jane@brokerage.com",
        listAgentId: "other-id",
        listAgentMlsId: "GA-777",
      }),
    ).toBe("jane@brokerage.com");
    expect(displayAttributionEmail({ attributionEmail: null, listAgentId: null })).toBeNull();
  });

  it("shows the feed's email, lowercased, on another agent's listing", () => {
    expect(
      displayAttributionEmail({
        attributionEmail: " Avery.adamsrealty@gmail.com ",
        listAgentId: "avery-id",
        listAgentMlsId: "AM6239",
      }),
    ).toBe("avery.adamsrealty@gmail.com");
  });

  it("still uses the override (lowercase) on her listings with a mixed-case feed email", () => {
    expect(
      displayAttributionEmail({ attributionEmail: "Andrea.AdamsRealty@Gmail.com", listAgentId: ANDREA_ID }),
    ).toBe(FIXED);
  });

  it("takes its overrides as a parameter", () => {
    const overrides = [{ agentId: "a1", mlsAgentId: "M1", email: "fixed@example.com" }];
    expect(displayAttributionEmail({ attributionEmail: "x@y.com", listAgentId: "a1" }, overrides)).toBe(
      "fixed@example.com",
    );
    expect(
      displayAttributionEmail({ attributionEmail: "x@y.com", listAgentId: ANDREA_ID }, overrides),
    ).toBe("x@y.com");
  });
});
