import { BellOff, BellRing, Check, House, Link2Off, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import type { AlertFrequency } from "@/lib/alerts/schedule";
import { verifyUnsubscribeToken } from "@/lib/alerts/token";
import { describeSubject, type UnsubscribeSubject } from "@/lib/alerts/unsubscribe";
import { cn } from "@/lib/cn";
import { confirmResubscribe, confirmUnsubscribe } from "@/server/actions/alerts";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = {
  title: "Email alerts",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const FREQUENCY: Record<AlertFrequency, string> = {
  instant: "Instant alerts",
  daily: "Daily digest",
  weekly: "Weekly digest",
  off: "No emails",
};

const param = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Landing page for the unsubscribe link in alert emails. Viewing it never
 * changes anything — mail scanners open links — so unsubscribing takes a
 * button press (a server action). The one-click header endpoint lives at
 * /alerts/one-click.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = param(sp.token);
  const target = verifyUnsubscribeToken(token);
  const subject = target ? await describeSubject(target) : null;
  const was = (["instant", "daily", "weekly"] as const).find((f) => f === param(sp.was));

  return (
    <Container className="flex max-w-xl flex-col items-center py-14 sm:py-24">
      <div className="w-full rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-10">
        {!subject ? (
          <State
            icon={<Link2Off />}
            tone="muted"
            title="This link has expired"
            body="Unsubscribe links work for 180 days. Sign in to manage your email alerts from your account instead."
          >
            <LinkButton href="/account#alerts" size="lg" className="w-full sm:w-auto">
              Sign in to manage alerts
            </LinkButton>
          </State>
        ) : subject.kind === "missing" ? (
          <State
            icon={<Check />}
            title="That saved search is gone"
            body="It was deleted, so you won't get any more emails about it."
          >
            <ManageLink />
          </State>
        ) : subject.active ? (
          param(sp.resubscribed) ? (
            <State
              icon={<BellRing />}
              title="Alerts are back on"
              body={
                subject.kind === "search"
                  ? `We'll email ${subject.email} about new matches for this search.`
                  : `We'll email ${subject.email} when your saved homes change price or status.`
              }
            >
              <SubjectCard subject={subject} />
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <LinkButton
                  href={subject.kind === "search" ? subject.searchUrl : "/saved"}
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  {subject.kind === "search" ? "View this search" : "See saved homes"}
                </LinkButton>
                <ManageLink className="sm:ml-2" />
              </div>
            </State>
          ) : (
            <State
              icon={<BellOff />}
              title={
                subject.kind === "search"
                  ? "Unsubscribe from this search?"
                  : "Stop saved-home updates?"
              }
              body={
                subject.kind === "search"
                  ? `We'll stop emailing ${subject.email} about new homes for this search. The search stays saved in your account.`
                  : `We'll stop emailing ${subject.email} when homes you've saved change price or status. Your saved homes stay in your account.`
              }
            >
              <SubjectCard subject={subject} />
              <form action={confirmUnsubscribe} className="mt-6 flex flex-col gap-3 sm:flex-row">
                <input type="hidden" name="token" value={token} />
                <SubmitButton pendingLabel="Unsubscribing…" className="w-full sm:w-auto">
                  Unsubscribe
                </SubmitButton>
                <LinkButton href="/" variant="secondary" size="lg" className="w-full sm:w-auto">
                  Keep my alerts
                </LinkButton>
              </form>
            </State>
          )
        ) : (
          <State
            icon={<Check />}
            title="You're unsubscribed"
            body={
              subject.kind === "search"
                ? `We won't email ${subject.email} about this search anymore. It's still saved in your account.`
                : `We won't email ${subject.email} about price or status changes on your saved homes. They're still saved in your account.`
            }
          >
            <SubjectCard subject={subject} />
            <form
              action={confirmResubscribe}
              className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <input type="hidden" name="token" value={token} />
              {was && <input type="hidden" name="frequency" value={was} />}
              <SubmitButton
                variant="secondary"
                pendingLabel="Turning on…"
                className="w-full sm:w-auto"
              >
                {subject.kind === "search" && was
                  ? `Undo — turn ${FREQUENCY[was].toLowerCase()} back on`
                  : "Undo — turn alerts back on"}
              </SubmitButton>
              <ManageLink className="sm:ml-2" />
            </form>
          </State>
        )}
      </div>
      <p className="mt-6 px-2 text-center text-sm text-muted">
        Alerts are emailed only when something changes. You can adjust every alert from{" "}
        <Link href="/saved" className="font-medium text-ink underline-offset-4 hover:underline">
          Saved homes
        </Link>
        .
      </p>
    </Container>
  );
}

function State({
  icon,
  title,
  body,
  tone = "brand",
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  tone?: "brand" | "muted";
  children?: ReactNode;
}) {
  return (
    <div>
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full [&_svg]:size-5",
          tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-sunken text-muted",
        )}
      >
        {icon}
      </span>
      <h1 className="mt-6 font-display-tight text-3xl font-normal text-ink sm:text-4xl">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-muted">{body}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}

function SubjectCard({ subject }: { subject: Exclude<UnsubscribeSubject, { kind: "missing" }> }) {
  const search = subject.kind === "search";
  return (
    <div className="flex items-start gap-3.5 rounded-2xl bg-sunken px-4 py-3.5">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand-700 ring-1 ring-line">
        {search ? <Search className="size-4" /> : <House className="size-4" />}
      </span>
      <div className="min-w-0">
        <p className="font-semibold break-words text-ink">
          {search ? subject.name : "Saved-home updates"}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {!subject.active
            ? "Emails off"
            : search
              ? `${FREQUENCY[subject.frequency]} · new listings and price cuts`
              : "Price drops and status changes on homes you've saved"}
        </p>
      </div>
    </div>
  );
}

function ManageLink({ className }: { className?: string }) {
  return (
    <Link
      href="/account#alerts"
      className={cn(
        "inline-flex min-h-10 items-center justify-center text-sm font-medium text-brand-700 underline-offset-4 hover:underline",
        className,
      )}
    >
      Manage all email alerts
    </Link>
  );
}
