/**
 * Authorization policy — the single place that decides who may do what.
 *
 * Pure functions with no I/O, so they're trivially unit-tested and usable on
 * both server (enforcement) and client (hiding controls). The UI hiding a
 * button is a courtesy; every server action and route handler must call these
 * again before touching data.
 *
 * Roles:
 * - user   Home shoppers. Save homes and searches, send inquiries.
 * - agent  Our licensed agents. Manage their own manual listings and leads.
 * - admin  Broker/staff. Everything, including roles, routing and data feeds.
 */

export type Role = "user" | "agent" | "admin";

export type Actor = {
  userId: string;
  role: Role;
  /** The agent profile linked to this login, if any. */
  agentId: string | null;
};

export type ListingSubject = {
  sourceKind: "manual" | "reso_web_api";
  listAgentId: string | null;
};

export type InquirySubject = { agentId: string | null };

export type OwnedSubject = { userId: string };

export type UserSubject = { userId: string; role: Role };

const isAdmin = (a: Actor | null) => a?.role === "admin";
const isStaff = (a: Actor | null) => a?.role === "admin" || a?.role === "agent";
const ownsAgentRecord = (a: Actor | null, agentId: string | null) =>
  a?.role === "agent" && a.agentId !== null && a.agentId === agentId;

export const can = {
  // --- Shoppers ---------------------------------------------------------
  saveListing: (a: Actor | null) => a !== null,
  manageOwn: (a: Actor | null, subject: OwnedSubject) => a !== null && a.userId === subject.userId,

  // --- Dashboard --------------------------------------------------------
  viewDashboard: (a: Actor | null) => isStaff(a),

  // --- Listings ---------------------------------------------------------
  /** Agents need a linked agent profile so the listing has someone to attribute. */
  createListing: (a: Actor | null) => isAdmin(a) || (a?.role === "agent" && a.agentId !== null),
  /** Feed listings are a read-only mirror of the MLS — edit them in the MLS. */
  editListing: (a: Actor | null, l: ListingSubject) =>
    l.sourceKind === "manual" && (isAdmin(a) || ownsAgentRecord(a, l.listAgentId)),
  deleteListing: (a: Actor | null, l: ListingSubject) => l.sourceKind === "manual" && isAdmin(a),
  /** Featuring affects what every visitor sees first, so it's a broker decision. */
  featureListing: (a: Actor | null) => isAdmin(a),
  viewAllListingsInDashboard: (a: Actor | null) => isAdmin(a),

  // --- Leads ------------------------------------------------------------
  viewAllInquiries: (a: Actor | null) => isAdmin(a),
  viewInquiry: (a: Actor | null, i: InquirySubject) => isAdmin(a) || ownsAgentRecord(a, i.agentId),
  updateInquiry: (a: Actor | null, i: InquirySubject) =>
    isAdmin(a) || ownsAgentRecord(a, i.agentId),
  assignInquiry: (a: Actor | null) => isAdmin(a),
  /** A copy of every new lead, whoever it goes to (the broker; Dashboard → Email settings). */
  copyOnAllLeads: (a: Actor | null) => isAdmin(a),
  /** Each agent's average reply time: the broker's view of the office. */
  viewReplyTimes: (a: Actor | null) => isAdmin(a),
  /** Staff choose which lead emails they get (copies, the morning summary). */
  manageEmailSettings: (a: Actor | null) => isStaff(a),

  // --- Administration ---------------------------------------------------
  manageUsers: (a: Actor | null) => isAdmin(a),
  /** Admins can't change their own role, so the last admin can't lock everyone out. */
  changeRole: (a: Actor | null, target: UserSubject) => isAdmin(a) && a?.userId !== target.userId,
  manageAgents: (a: Actor | null) => isAdmin(a),
  editAgentProfile: (a: Actor | null, agentId: string) => isAdmin(a) || ownsAgentRecord(a, agentId),
  manageDataSources: (a: Actor | null) => isAdmin(a),
  /** Listing page-view statistics (shared with Georgia MLS on request). */
  viewTrafficStats: (a: Actor | null) => isAdmin(a),
} as const;

export type Permission = keyof typeof can;

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws unless `allowed` is true. Use in server actions and route handlers. */
export function authorize(allowed: boolean, message?: string): asserts allowed {
  if (!allowed) throw new ForbiddenError(message);
}
