import { AlarmClock, CalendarClock, ChevronRight, Hourglass } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  attentionCount,
  followUpOverdue,
  formatAttentionTime,
  leadWhat,
  type Attention,
  type AttentionLead,
  type AttentionList,
  type ReplyTimeRow,
} from "@/lib/leads/attention";
import { formatOfficeDuration, WAIT_RULE, waitingLabel } from "@/lib/leads/working-hours";

/** A red pill: how long a lead has waited, or a follow-up that's past its date. */
export function AlertPill({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-clay-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-clay-600"
      data-testid={testId}
    >
      {children}
    </span>
  );
}

/**
 * The "Needs attention" box at the top of the dashboard (site review #9): new
 * leads waiting too long (red, "Waiting 4 days"), tours in the next 48 hours
 * and follow-ups due, each a link to the lead. The same lists as the morning
 * email (src/lib/leads/digest.ts).
 */
export function NeedsAttention({
  attention,
  office,
  now,
}: {
  attention: Attention;
  /** The broker's view: show whose lead it is. */
  office: boolean;
  now: Date;
}) {
  const empty = attentionCount(attention) === 0;
  const who = (l: AttentionLead) =>
    office ? (
      <span className={l.agentName ? undefined : "text-clay-600"}>
        {l.agentName ?? "Unassigned"}
      </span>
    ) : null;
  return (
    <section
      aria-labelledby="attention-heading"
      className="mb-8 rounded-2xl border border-line bg-surface"
      data-testid="needs-attention"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
        <h2 id="attention-heading" className="text-lg font-semibold text-ink">
          Needs attention
        </h2>
        <p className="text-xs text-muted">A new lead waits too long after {WAIT_RULE}.</p>
      </header>
      {empty ? (
        <p className="px-5 py-6 text-sm text-muted" data-testid="attention-empty">
          Nothing needs attention right now: no new lead is waiting too long, no tours in the next
          48 hours and no follow-ups due.
        </p>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <Group
            title="Waiting too long"
            icon={<Hourglass />}
            list={attention.waiting}
            testId="attention-waiting"
            more={{ href: "/dashboard/leads?status=new", label: "See all new leads" }}
            render={(l) => (
              <>
                <Line>
                  <Name>{l.name}</Name>
                  <AlertPill testId="waiting-label">{waitingLabel(l.createdAt, now)}</AlertPill>
                </Line>
                <Detail>
                  {leadWhat(l)}
                  {office && <> · {who(l)}</>}
                </Detail>
              </>
            )}
          />
          <Group
            title="Tours in the next 48 hours"
            icon={<CalendarClock />}
            list={attention.tours}
            testId="attention-tours"
            render={(l) => (
              <>
                <Line>
                  <Name>{l.name}</Name>
                </Line>
                <Detail>
                  <span className="font-medium text-brass-700">
                    {formatAttentionTime(l.tourAt!)}
                    {l.tourType === "video" && " · video"}
                  </span>
                  {" · "}
                  {leadWhat(l)}
                  {office && <> · {who(l)}</>}
                </Detail>
              </>
            )}
          />
          <Group
            title="Follow-ups due"
            icon={<AlarmClock />}
            list={attention.followUps}
            testId="attention-follow-ups"
            render={(l) => {
              const overdue = followUpOverdue(l.followUpOn, attention.today);
              return (
                <>
                  <Line>
                    <Name>{l.name}</Name>
                    {overdue ? (
                      <AlertPill>{overdue}</AlertPill>
                    ) : (
                      <span className="text-xs font-medium text-ink-soft">Today</span>
                    )}
                  </Line>
                  <Detail>
                    {leadWhat(l)}
                    {office && <> · {who(l)}</>}
                  </Detail>
                </>
              );
            }}
          />
        </div>
      )}
    </section>
  );
}

function Group({
  title,
  icon,
  list,
  render,
  testId,
  more,
}: {
  title: string;
  icon: ReactNode;
  list: AttentionList;
  render: (lead: AttentionLead) => ReactNode;
  testId: string;
  more?: { href: string; label: string };
}) {
  return (
    <div className="min-w-0 px-5 py-4" data-testid={testId}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink [&_svg]:size-4 [&_svg]:text-muted">
        {icon}
        {title}
        <span className="text-muted tabular" data-testid="count">
          {list.total}
        </span>
      </h3>
      {list.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None</p>
      ) : (
        <ul className="-mx-2 mt-2 space-y-0.5">
          {list.items.map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="group flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-sunken/70"
              >
                <div className="min-w-0 flex-1">{render(l)}</div>
                <ChevronRight
                  className="size-4 shrink-0 text-faint group-hover:text-brand-700"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && list.total > list.items.length && (
        <Link
          href={more.href}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
        >
          {more.label} ({list.total})
        </Link>
      )}
    </div>
  );
}

const Line = ({ children }: { children: ReactNode }) => (
  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</p>
);
const Name = ({ children }: { children: ReactNode }) => (
  <span className="truncate font-medium text-ink group-hover:text-brand-700">{children}</span>
);
const Detail = ({ children }: { children: ReactNode }) => (
  <p className="mt-0.5 text-xs text-muted">{children}</p>
);

/**
 * The broker's reply-time table: each agent's average time to first contact
 * (office hours), how many leads that covers, and how many are waiting too
 * long right now.
 */
export function ReplyTimes({ rows, days }: { rows: ReplyTimeRow[]; days: number }) {
  return (
    <section aria-labelledby="reply-heading" className="mt-10" data-testid="reply-times">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="reply-heading" className="text-lg font-semibold text-ink">
          Reply times
        </h2>
        <p className="text-xs text-muted">
          Leads from the last {days} days, arrival to first contact, in office hours (Mon–Fri, 9–5)
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-sunken px-5 py-6 text-center text-sm text-muted">
          No replies recorded yet. A lead counts once its status moves to Contacted or Qualified.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sunken/60 text-left text-xs font-medium tracking-wide text-muted uppercase">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-3 py-3 text-right font-medium">Average reply</th>
                <th className="hidden px-3 py-3 text-right font-medium sm:table-cell">Leads</th>
                <th className="px-4 py-3 text-right font-medium">Waiting now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.agentId} className="border-t border-line" data-testid="reply-row">
                  <td className="px-4 py-3 font-medium text-ink">{r.agentName}</td>
                  <td className="px-3 py-3 text-right text-ink-soft tabular">
                    {r.averageMs === null ? "—" : formatOfficeDuration(r.averageMs)}
                    <span className="block text-xs text-muted sm:hidden">
                      {r.replied} {r.replied === 1 ? "lead" : "leads"}
                    </span>
                  </td>
                  <td className="hidden px-3 py-3 text-right text-ink-soft tabular sm:table-cell">
                    {r.replied}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right tabular",
                      r.waitingNow ? "font-semibold text-clay-600" : "text-muted",
                    )}
                  >
                    {r.waitingNow}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
