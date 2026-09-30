import { and, asc, eq, gt, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { site } from "@/config/site";
import type { Executor } from "@/db";
import { agents, inquiries, listings } from "@/db/schema";
import type { Actor } from "@/lib/auth/permissions";
import { can } from "@/lib/auth/permissions";
import {
  formatDay,
  marketToday,
  WAIT_LIMIT_MS,
  workingCutoff,
  workingMsBetween,
} from "./working-hours";

/**
 * "Needs attention" (site review #9): what a person should act on today, for
 * the box at the top of the dashboard and the 7 a.m. summary email
 * (./digest.ts), from one query so the two never disagree.
 *
 * - Waiting too long: new leads that have waited more than 2 office hours
 *   (./working-hours.ts), oldest first. Spam never counts: its status is `spam`.
 * - Tours in the next 48 hours, soonest first (not spam or closed).
 * - Follow-ups due: open leads whose "Follow up on" date is today or earlier.
 *
 * `scope` is one agent's leads, or the whole office (admins), unassigned
 * leads included.
 */

export type AttentionScope = { kind: "office" } | { kind: "agent"; agentId: string };

/** The scope an actor's dashboard shows; null for staff with no agent profile to scope by. */
export function attentionScope(actor: Actor): AttentionScope | null {
  if (can.viewAllInquiries(actor)) return { kind: "office" };
  return actor.agentId ? { kind: "agent", agentId: actor.agentId } : null;
}

export const TOUR_WINDOW_MS = 48 * 3_600_000;
const OPEN = ["new", "contacted", "qualified"] as const;

export type AttentionLead = {
  id: string;
  name: string;
  type: (typeof inquiries.type.enumValues)[number];
  status: (typeof inquiries.status.enumValues)[number];
  agentId: string | null;
  agentName: string | null;
  /** The home's street (staff see withheld addresses too), or null when the lead isn't about one. */
  listingStreet: string | null;
  listingCity: string | null;
  createdAt: Date;
  tourAt: Date | null;
  tourType: "in_person" | "video" | null;
  followUpOn: string | null;
};

export type AttentionList = { items: AttentionLead[]; total: number };

export type Attention = {
  waiting: AttentionList;
  tours: AttentionList;
  followUps: AttentionList;
  /** The market's calendar day the follow-ups are due by. */
  today: string;
  /** Leads created at or before this have waited too long. */
  cutoff: Date;
};

const leadColumns = {
  id: inquiries.id,
  name: inquiries.name,
  type: inquiries.type,
  status: inquiries.status,
  agentId: inquiries.agentId,
  agentName: agents.name,
  listingStreet: sql<
    string | null
  >`case when ${listings.unitNumber} is null then ${listings.addressLine1} else ${listings.addressLine1} || ' #' || ${listings.unitNumber} end`,
  listingCity: listings.city,
  createdAt: inquiries.createdAt,
  tourAt: inquiries.tourAt,
  tourType: inquiries.tourType,
  followUpOn: inquiries.followUpOn,
  total: sql<number>`(count(*) over ())::int`,
};

function scopeCondition(scope: AttentionScope): SQL | undefined {
  return scope.kind === "agent" ? eq(inquiries.agentId, scope.agentId) : undefined;
}

async function list(
  db: Executor,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
): Promise<AttentionList> {
  const rows = await db
    .select(leadColumns)
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(where)
    .orderBy(...order)
    .limit(limit);
  return {
    // `total` is the window count, the same on every row.
    items: rows.map(({ total, ...lead }) => (void total, lead)),
    total: rows[0]?.total ?? 0,
  };
}

export async function getNeedsAttention(
  db: Executor,
  scope: AttentionScope,
  now: Date = new Date(),
  opts: { limit?: number; timeZone?: string } = {},
): Promise<Attention> {
  const limit = opts.limit ?? 20;
  const timeZone = opts.timeZone ?? site.market.timeZone;
  const cutoff = workingCutoff(now, WAIT_LIMIT_MS, timeZone);
  const today = marketToday(now, timeZone);
  const inScope = scopeCondition(scope);
  const [waiting, tours, followUps] = await Promise.all([
    list(
      db,
      and(inScope, eq(inquiries.status, "new"), lte(inquiries.createdAt, cutoff)),
      [asc(inquiries.createdAt), asc(inquiries.id)],
      limit,
    ),
    list(
      db,
      and(
        inScope,
        eq(inquiries.type, "tour"),
        gt(inquiries.tourAt, now),
        lte(inquiries.tourAt, new Date(now.getTime() + TOUR_WINDOW_MS)),
        inArray(inquiries.status, OPEN),
      ),
      [asc(inquiries.tourAt), asc(inquiries.id)],
      limit,
    ),
    list(
      db,
      and(
        inScope,
        isNotNull(inquiries.followUpOn),
        lte(inquiries.followUpOn, today),
        inArray(inquiries.status, OPEN),
      ),
      [asc(inquiries.followUpOn), asc(inquiries.createdAt), asc(inquiries.id)],
      limit,
    ),
  ]);
  return { waiting, tours, followUps, today, cutoff };
}

/** Total of the three lists (a lead in two lists counts twice: it needs both). */
export function attentionCount(a: Attention): number {
  return a.waiting.total + a.tours.total + a.followUps.total;
}

export type ReplyTimeRow = {
  agentId: string;
  agentName: string;
  /** Leads first contacted in the window. */
  replied: number;
  /** Average office time from arrival to first contact; null when none replied. */
  averageMs: number | null;
  /** New leads assigned to the agent that are waiting too long right now. */
  waitingNow: number;
};

/** How far back the broker's reply-time table looks. */
export const REPLY_WINDOW_DAYS = 90;

/**
 * Each agent's average reply time (office hours, arrival to first contact) over
 * leads that arrived in the last REPLY_WINDOW_DAYS, with how many of their new
 * leads are waiting too long now. For the broker (callers check
 * `can.viewAllInquiries`). Leads handled before first contact was recorded
 * have no `first_contacted_at` and don't count.
 */
export async function getReplyTimes(
  db: Executor,
  now: Date = new Date(),
  timeZone: string = site.market.timeZone,
): Promise<ReplyTimeRow[]> {
  const since = new Date(now.getTime() - REPLY_WINDOW_DAYS * 86_400_000);
  const cutoff = workingCutoff(now, WAIT_LIMIT_MS, timeZone);
  const [replies, waiting] = await Promise.all([
    db
      .select({
        agentId: agents.id,
        agentName: agents.name,
        createdAt: inquiries.createdAt,
        firstContactedAt: inquiries.firstContactedAt,
      })
      .from(inquiries)
      .innerJoin(agents, eq(inquiries.agentId, agents.id))
      .where(and(isNotNull(inquiries.firstContactedAt), gte(inquiries.createdAt, since))),
    db
      .select({
        agentId: agents.id,
        agentName: agents.name,
        count: sql<number>`count(*)::int`,
      })
      .from(inquiries)
      .innerJoin(agents, eq(inquiries.agentId, agents.id))
      .where(and(eq(inquiries.status, "new"), lte(inquiries.createdAt, cutoff)))
      .groupBy(agents.id, agents.name),
  ]);
  const rows = new Map<string, ReplyTimeRow & { sum: number }>();
  const row = (agentId: string, agentName: string) => {
    let r = rows.get(agentId);
    if (!r) {
      r = { agentId, agentName, replied: 0, averageMs: null, waitingNow: 0, sum: 0 };
      rows.set(agentId, r);
    }
    return r;
  };
  for (const r of replies) {
    const entry = row(r.agentId, r.agentName);
    entry.replied++;
    entry.sum += workingMsBetween(r.createdAt, r.firstContactedAt!, timeZone);
  }
  for (const w of waiting) row(w.agentId, w.agentName).waitingNow = w.count;
  return [...rows.values()]
    .map(({ sum, ...r }) => ({ ...r, averageMs: r.replied ? sum / r.replied : null }))
    .sort((a, b) => a.agentName.localeCompare(b.agentName));
}

// --- Wording shared by the dashboard box and the morning email -------------

export const ATTENTION_TYPE_LABELS: Record<string, string> = {
  tour: "Tour request",
  question: "Question",
  offer: "Offer",
  valuation: "Valuation request",
  general: "Message",
};

/** "Tour request · 12 Oak St, Royston", or just the type when it isn't about a home. */
export function leadWhat(lead: Pick<AttentionLead, "type" | "listingStreet" | "listingCity">) {
  const type = ATTENTION_TYPE_LABELS[lead.type] ?? lead.type;
  return lead.listingStreet ? `${type} · ${lead.listingStreet}, ${lead.listingCity}` : type;
}

/** "Thu, Oct 1, 2:00 PM" in the market's time zone. */
export function formatAttentionTime(at: Date, timeZone: string = site.market.timeZone): string {
  return at.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A follow-up that's past its date: "Was due Mon, Sep 28"; null when it's due today. */
export function followUpOverdue(followUpOn: string | null, today: string): string | null {
  return followUpOn && followUpOn < today ? `Was due ${formatDay(followUpOn)}` : null;
}
