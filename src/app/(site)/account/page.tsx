import { count, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { HomeAlertsToggle, PasswordForm, ProfileForm } from "@/components/account/account-forms";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { db } from "@/db";
import { savedListings, savedSearches, users } from "@/db/schema";
import { getSession, requireActor } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage() {
  const actor = await requireActor("/account");
  const session = (await getSession())!;
  const u = session.user;
  // Read from the database, not the session: the session cookie is cached for minutes.
  const [[prefs], [homes], [searches]] = await Promise.all([
    db
      .select({ homeAlerts: users.homeAlerts })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1),
    db.select({ n: count() }).from(savedListings).where(eq(savedListings.userId, actor.userId)),
    db
      .select({
        total: count(),
        alerting:
          sql<number>`count(*) filter (where ${savedSearches.alertFrequency} <> 'off')`.mapWith(
            Number,
          ),
      })
      .from(savedSearches)
      .where(eq(savedSearches.userId, actor.userId)),
  ]);

  return (
    <Container className="max-w-3xl py-12">
      <h1 className="font-display-tight text-4xl font-normal text-ink">Account</h1>
      <div className="mt-10 grid gap-10">
        <section className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="mb-6 text-lg font-semibold text-ink">Profile</h2>
          <ProfileForm name={u.name} email={u.email} phone={u.phone ?? null} />
        </section>
        <section
          id="alerts"
          className="scroll-mt-24 rounded-3xl border border-line bg-surface p-6 sm:p-8"
        >
          <h2 className="text-lg font-semibold text-ink">Email alerts</h2>
          <p className="mt-1 text-sm text-muted">
            Sent to {u.email}. Every alert has an unsubscribe link, and we only write when something
            changes.
          </p>
          <div className="mt-6 divide-y divide-line">
            <div className="pb-6">
              <HomeAlertsToggle enabled={prefs?.homeAlerts ?? true} savedCount={homes?.n ?? 0} />
            </div>
            <div className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="min-w-0">
                <p className="font-medium text-ink">Saved searches</p>
                <p className="mt-0.5 text-sm text-muted">
                  {!searches?.total
                    ? "Save a search from home search to get new listings and price cuts by email."
                    : searches.total === 1
                      ? searches.alerting
                        ? "Your saved search emails you new listings and price cuts."
                        : "Alerts are off for your saved search."
                      : `Alerts are on for ${searches.alerting} of your ${searches.total} saved searches.`}{" "}
                  {searches?.total
                    ? `Choose instant, daily or weekly${searches.total > 1 ? " for each one" : ""}.`
                    : null}
                </p>
              </div>
              <LinkButton
                href={searches?.total ? "/saved" : "/homes"}
                variant="secondary"
                className="shrink-0 self-start sm:self-center"
              >
                {searches?.total ? "Manage search alerts" : "Start a search"}
              </LinkButton>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="mb-6 text-lg font-semibold text-ink">Password</h2>
          <PasswordForm />
        </section>
        <p className="text-sm text-muted">
          Want your account and data deleted? Email us and we&apos;ll take care of it within 7 days.
        </p>
      </div>
    </Container>
  );
}
