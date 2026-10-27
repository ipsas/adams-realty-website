import { and, eq } from "drizzle-orm";
import { site } from "@/config/site";
import { db as defaultDb, type Executor } from "@/db";
import { agents, leadDigests, users } from "@/db/schema";
import { displayAgentEmail } from "@/lib/agents/display-email";
import { localClock, SEND_HOUR } from "@/lib/alerts/schedule";
import { emailConfigured, sendEmail, type SendEmail } from "@/lib/email";
import { createBatchBudget, type BatchBudget } from "@/lib/email-batch";
import { leadDigestEmail, type DigestLead, type DigestSection } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { describeError } from "@/lib/mls/write-errors";
import {
  attentionCount,
  followUpOverdue,
  formatAttentionTime,
  getNeedsAttention,
  leadWhat,
  type Attention,
  type AttentionLead,
  type AttentionList,
  type AttentionScope,
} from "./attention";
import { emailSettingsUrl, leadPageUrl } from "./notify";
import { waitingLabel, WAIT_RULE } from "./working-hours";

/**
 * The 7 a.m. morning summary (site review #9): each agent gets their own
 * "needs attention" list (./attention.ts: new leads waiting too long, tours in
 * the next 48 hours, follow-ups due), and each admin the whole office's.
 * Nothing to report, no email. `users.lead_digest` turns it off per person
 * (Dashboard → Email settings).
 *
 * There is no cron of its own: /api/cron/sync (every 15 minutes on Vercel
 * Pro) and /api/cron/alerts (hourly) both call it. A run before 7 a.m.
 * Eastern does nothing, and the first run at or after it sends. Each recipient's day is claimed in `lead_digests`
 * before sending, so the later run (or a retry) never sends twice; a failed
 * send gives the claim back for the next run.
 *
 * Who gets one: admins (office-wide), and logins with the agent role that
 * are linked to an agent profile (their leads). An admin with an agent
 * profile gets only the office summary, which already has their leads.
 * Agent profiles with no login can't open the dashboard, so they get none.
 */

export type DigestRunResult = {
  ok: boolean;
  /**
   * Set when the run did nothing: it's before 7 a.m. local, or email isn't
   * configured (no RESEND_API_KEY), so no summary is claimed for the day.
   */
  skipped?: "before-send-hour" | "email-not-configured";
  day: string;
  recipients: number;
  emailed: number;
  /** Nothing needed attention: no email. */
  empty: number;
  /** Already handled today by an earlier run (sent, or nothing to say); costs no batch send. */
  alreadyDone: number;
  failed: number;
  /** Not started before the deadline, the batch-mail guard's stop or a 429; the next run picks them up. */
  deferred: number;
};

type Recipient = {
  key: string;
  email: string;
  firstName: string;
  scope: AttentionScope;
};

export type RunLeadDigestsOptions = {
  db?: Executor;
  now?: Date;
  send?: SendEmail;
  /** Whether email can be sent. Default: `emailConfigured()`, or true when `send` is given. */
  configured?: boolean;
  siteUrl?: string;
  timeZone?: string;
  /** Epoch ms after which no new recipient is started. */
  deadline?: number;
  /** The batch-mail guard, shared with the cron request's other batch jobs. Default: a new one. */
  budget?: BatchBudget;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export async function digestRecipients(db: Executor): Promise<Recipient[]> {
  const [admins, agentLogins] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.leadDigest, true)))
      .orderBy(users.name),
    db
      .select({
        agentId: agents.id,
        mlsAgentId: agents.mlsAgentId,
        name: agents.name,
        email: agents.email,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .where(and(eq(users.role, "agent"), eq(users.leadDigest, true)))
      .orderBy(agents.name),
  ]);
  return [
    ...admins.map((a) => ({
      key: `office:${a.id}`,
      email: a.email,
      firstName: firstName(a.name),
      scope: { kind: "office" } as const,
    })),
    ...agentLogins.map((a) => ({
      key: `agent:${a.agentId}`,
      email: displayAgentEmail({ ...a, id: a.agentId }),
      firstName: firstName(a.name),
      scope: { kind: "agent", agentId: a.agentId } as const,
    })),
  ];
}

/** The email for one recipient's attention lists. */
export function digestEmail(
  a: Attention,
  input: { firstName: string; office: boolean; now: Date; siteUrl: string; timeZone?: string },
) {
  const timeZone = input.timeZone ?? site.market.timeZone;
  const who = (l: AttentionLead) => (input.office ? ` · ${l.agentName ?? "Unassigned"}` : "");
  const section = (
    title: string,
    list: AttentionList,
    item: (l: AttentionLead) => Omit<DigestLead, "name" | "href">,
  ): DigestSection => ({
    title,
    total: list.total,
    items: list.items.map((l) => ({
      name: l.name,
      href: leadPageUrl(input.siteUrl, l.id),
      ...item(l),
    })),
  });
  return leadDigestEmail({
    firstName: input.firstName,
    office: input.office,
    dateLabel: input.now.toLocaleDateString("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    waiting: section("Waiting too long", a.waiting, (l) => ({
      detail: `${leadWhat(l)}${who(l)}`,
      alert: waitingLabel(l.createdAt, input.now),
    })),
    tours: section("Tours in the next 48 hours", a.tours, (l) => ({
      detail: `${formatAttentionTime(l.tourAt!, timeZone)}${l.tourType === "video" ? " (video)" : ""} · ${leadWhat(l)}${who(l)}`,
    })),
    followUps: section("Follow-ups due", a.followUps, (l) => ({
      detail: `${leadWhat(l)}${who(l)}`,
      alert: followUpOverdue(l.followUpOn, a.today),
    })),
    waitRule: WAIT_RULE,
    dashboardUrl: `${input.siteUrl}/dashboard`,
    settingsUrl: emailSettingsUrl(input.siteUrl),
  });
}

/** Claims `recipient`'s summary for `day`; false when an earlier run already did. */
async function claim(db: Executor, recipient: string, day: string): Promise<boolean> {
  const rows = await db
    .insert(leadDigests)
    .values({ recipient, day })
    .onConflictDoNothing()
    .returning({ recipient: leadDigests.recipient });
  return rows.length > 0;
}

export async function runLeadDigests(opts: RunLeadDigestsOptions = {}): Promise<DigestRunResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendEmail;
  const siteUrl = opts.siteUrl ?? env.NEXT_PUBLIC_SITE_URL;
  const timeZone = opts.timeZone ?? site.market.timeZone;
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const budget = opts.budget ?? createBatchBudget({ db });
  const clock = localClock(now, timeZone);
  const result: DigestRunResult = {
    ok: true,
    day: clock.date,
    recipients: 0,
    emailed: 0,
    empty: 0,
    alreadyDone: 0,
    failed: 0,
    deferred: 0,
  };
  if (clock.hour < SEND_HOUR) return { ...result, skipped: "before-send-hour" };
  if (!(opts.configured ?? (opts.send ? true : emailConfigured()))) {
    console.warn("[digest] skipped: email not configured");
    return { ...result, skipped: "email-not-configured" };
  }

  const recipients = await digestRecipients(db);
  result.recipients = recipients.length;
  // Already claimed today (sent, or nothing to say): skipped without a reservation,
  // so a sync run after everyone's done costs these two queries and nothing more.
  const claimedToday = new Set(
    (
      await db
        .select({ recipient: leadDigests.recipient })
        .from(leadDigests)
        .where(eq(leadDigests.day, clock.date))
    ).map((row) => row.recipient),
  );
  for (const r of recipients) {
    if (claimedToday.has(r.key)) {
      result.alreadyDone++;
      continue;
    }
    // Out of time or of batch sends (email-batch.ts): the day stays unclaimed for the next run.
    const slot = Date.now() > deadline ? null : await budget.reserve(send);
    if (!slot) {
      result.deferred++;
      continue;
    }
    try {
      if (!(await claim(db, r.key, clock.date))) {
        result.alreadyDone++;
        continue;
      }
      try {
        const attention = await getNeedsAttention(db, r.scope, now, { limit: 10, timeZone });
        const items = attentionCount(attention);
        if (items === 0) {
          result.empty++;
          continue;
        }
        const email = digestEmail(attention, {
          firstName: r.firstName,
          office: r.scope.kind === "office",
          now,
          siteUrl,
          timeZone,
        });
        const sent = await slot.send({
          kind: "lead-digest",
          to: r.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
          idempotencyKey: `lead-digest:${r.key}:${clock.date}`,
        });
        if (!sent.ok) throw new Error(`email not sent (${sent.reason})`);
        await db
          .update(leadDigests)
          .set({ items })
          .where(and(eq(leadDigests.recipient, r.key), eq(leadDigests.day, clock.date)));
        result.emailed++;
      } catch (error) {
        // Give the day back so the next run tries again.
        await db
          .delete(leadDigests)
          .where(and(eq(leadDigests.recipient, r.key), eq(leadDigests.day, clock.date)))
          .catch(() => {});
        throw error;
      }
    } catch (error) {
      // A 429 is a planned deferral: the day was given back for the next run.
      if (slot.rateLimited) result.deferred++;
      else {
        result.failed++;
        console.error(`[digest] ${r.key} failed: ${describeError(error)}`);
      }
    } finally {
      await slot.release();
    }
  }
  result.ok = result.failed === 0;
  return result;
}
