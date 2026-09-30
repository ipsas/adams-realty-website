import { eq } from "drizzle-orm";
import { EmailSettingSwitch } from "@/components/dashboard/email-settings";
import { PageHeader } from "@/components/dashboard/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { WAIT_RULE } from "@/lib/leads/working-hours";

export const metadata = { title: "Email settings" };

/**
 * Which lead emails a staff member gets (site review #3, #9). New leads and
 * leads assigned to you are always emailed: they're the job. The broker's
 * copies of every lead and the morning summary can be turned off.
 */
export default async function EmailSettingsPage() {
  const actor = await requirePermission("/dashboard/settings", can.manageEmailSettings);
  const [me] = await db
    .select({ email: users.email, leadCopies: users.leadCopies, leadDigest: users.leadDigest })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1);
  const office = can.viewAllInquiries(actor);
  return (
    <>
      <PageHeader
        title="Email settings"
        description={
          office
            ? `Lead copies and the office summary go to ${me.email}, your sign-in email.`
            : "Lead emails go to the email on your agent profile."
        }
      />
      <section
        aria-labelledby="lead-emails-heading"
        className="max-w-2xl rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <h2 id="lead-emails-heading" className="sr-only">
          Lead emails
        </h2>
        <div className="divide-y divide-line">
          {can.copyOnAllLeads(actor) && (
            <EmailSettingSwitch
              setting="leadCopies"
              enabled={me.leadCopies}
              label="Copy me on every new lead"
              hint="Your own copy of each new lead's email, whoever it went to: an agent, you, or the office inbox. Suspected spam and listing problem reports aren't copied."
              onText="You'll get a copy of every new lead."
              offText="Copies are off. You still get leads assigned to you."
            />
          )}
          <EmailSettingSwitch
            setting="leadDigest"
            enabled={me.leadDigest}
            label="Morning summary at 7 a.m."
            hint={`${office ? "The whole office's" : "Your"} new leads waiting more than ${WAIT_RULE}, tours in the next 48 hours and follow-ups due. No email on a day with nothing to report.`}
            onText="The morning summary is on."
            offText="The morning summary is off."
          />
        </div>
        <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
          New leads and leads assigned to you are always emailed{office ? "" : " to you"}.
        </p>
      </section>
    </>
  );
}
