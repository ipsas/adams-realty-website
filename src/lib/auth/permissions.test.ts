import { describe, expect, it } from "vitest";
import { authorize, can, ForbiddenError, type Actor } from "./permissions";

const shopper: Actor = { userId: "u1", role: "user", agentId: null };
const agent: Actor = { userId: "u2", role: "agent", agentId: "agent-2" };
const otherAgent: Actor = { userId: "u3", role: "agent", agentId: "agent-3" };
const unlinkedAgent: Actor = { userId: "u5", role: "agent", agentId: null };
const admin: Actor = { userId: "u4", role: "admin", agentId: null };

const manualByAgent = { sourceKind: "manual" as const, listAgentId: "agent-2" };
const feedByAgent = { sourceKind: "reso_web_api" as const, listAgentId: "agent-2" };

describe("listing permissions", () => {
  it("lets agents edit only their own manual listings", () => {
    expect(can.editListing(agent, manualByAgent)).toBe(true);
    expect(can.editListing(otherAgent, manualByAgent)).toBe(false);
    expect(can.editListing(shopper, manualByAgent)).toBe(false);
    expect(can.editListing(null, manualByAgent)).toBe(false);
  });

  it("treats MLS feed listings as read-only, even for admins", () => {
    expect(can.editListing(agent, feedByAgent)).toBe(false);
    expect(can.editListing(admin, feedByAgent)).toBe(false);
    expect(can.deleteListing(admin, feedByAgent)).toBe(false);
  });

  it("lets admins edit and delete any manual listing", () => {
    expect(can.editListing(admin, manualByAgent)).toBe(true);
    expect(can.deleteListing(admin, manualByAgent)).toBe(true);
    expect(can.deleteListing(agent, manualByAgent)).toBe(false);
  });

  it("requires a linked agent profile to create listings", () => {
    expect(can.createListing(agent)).toBe(true);
    expect(can.createListing(unlinkedAgent)).toBe(false);
    expect(can.createListing(admin)).toBe(true);
    expect(can.createListing(shopper)).toBe(false);
  });

  it("does not let an unlinked agent match a listing with no agent", () => {
    const orphan = { sourceKind: "manual" as const, listAgentId: null };
    expect(can.editListing(unlinkedAgent, orphan)).toBe(false);
  });

  it("reserves featuring for admins", () => {
    expect(can.featureListing(admin)).toBe(true);
    expect(can.featureListing(agent)).toBe(false);
  });
});

describe("lead permissions", () => {
  const lead = { agentId: "agent-2" };

  it("scopes leads to the assigned agent", () => {
    expect(can.viewInquiry(agent, lead)).toBe(true);
    expect(can.updateInquiry(agent, lead)).toBe(true);
    expect(can.viewInquiry(otherAgent, lead)).toBe(false);
    expect(can.viewInquiry(shopper, lead)).toBe(false);
  });

  it("keeps unassigned leads admin-only", () => {
    const unassigned = { agentId: null };
    expect(can.viewInquiry(admin, unassigned)).toBe(true);
    expect(can.viewInquiry(unlinkedAgent, unassigned)).toBe(false);
  });

  it("lets only admins see all leads and reassign them", () => {
    expect(can.viewAllInquiries(admin)).toBe(true);
    expect(can.viewAllInquiries(agent)).toBe(false);
    expect(can.assignInquiry(agent)).toBe(false);
  });

  it("gives only admins lead copies and the office's reply times; every staff member their email settings", () => {
    expect(can.copyOnAllLeads(admin)).toBe(true);
    expect(can.copyOnAllLeads(agent)).toBe(false);
    expect(can.viewReplyTimes(admin)).toBe(true);
    expect(can.viewReplyTimes(agent)).toBe(false);
    expect(can.manageEmailSettings(agent)).toBe(true);
    expect(can.manageEmailSettings(admin)).toBe(true);
    expect(can.manageEmailSettings(shopper)).toBe(false);
    expect(can.manageEmailSettings(null)).toBe(false);
  });
});

describe("account and admin permissions", () => {
  it("lets signed-in users save homes", () => {
    expect(can.saveListing(shopper)).toBe(true);
    expect(can.saveListing(null)).toBe(false);
  });

  it("limits saved searches to their owner", () => {
    expect(can.manageOwn(shopper, { userId: "u1" })).toBe(true);
    expect(can.manageOwn(shopper, { userId: "someone-else" })).toBe(false);
    expect(can.manageOwn(admin, { userId: "u1" })).toBe(false);
  });

  it("opens the dashboard to staff only", () => {
    expect(can.viewDashboard(agent)).toBe(true);
    expect(can.viewDashboard(admin)).toBe(true);
    expect(can.viewDashboard(shopper)).toBe(false);
    expect(can.viewDashboard(null)).toBe(false);
  });

  it("prevents admins from changing their own role", () => {
    expect(can.changeRole(admin, { userId: "u1", role: "user" })).toBe(true);
    expect(can.changeRole(admin, { userId: "u4", role: "admin" })).toBe(false);
    expect(can.changeRole(agent, { userId: "u1", role: "user" })).toBe(false);
  });

  it("lets agents edit only their own profile", () => {
    expect(can.editAgentProfile(agent, "agent-2")).toBe(true);
    expect(can.editAgentProfile(agent, "agent-3")).toBe(false);
    expect(can.editAgentProfile(admin, "agent-3")).toBe(true);
  });
});

describe("authorize", () => {
  it("throws ForbiddenError when not allowed", () => {
    expect(() => authorize(false)).toThrow(ForbiddenError);
    expect(() => authorize(true)).not.toThrow();
  });
});
