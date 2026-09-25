import { UserRound } from "lucide-react";
import Link from "next/link";
import { forbidden } from "next/navigation";
import type { ReactNode } from "react";
import { AgentForm } from "@/components/dashboard/agent-form";
import { PageHeader } from "@/components/dashboard/ui";
import { LinkButton } from "@/components/ui/button";
import { getAgentForEdit, toAgentFormValues } from "@/lib/agents/admin-queries";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const actor = await requirePermission("/dashboard/profile", can.viewDashboard);
  const admin = actor.role === "admin";
  const row = actor.agentId ? await getAgentForEdit(actor.agentId) : null;
  if (!row) return <NoProfile admin={admin} />;
  const a = row.agent;
  if (!can.editAgentProfile(actor, a.id)) forbidden();

  return (
    <>
      <PageHeader
        title="My profile"
        description={
          a.isActive ? (
            <>
              Your public page is{" "}
              <Link
                href={`/agents/${a.slug}`}
                className="font-medium text-brand-700 hover:underline"
              >
                /agents/{a.slug}
              </Link>
              . Changes show there as soon as you save.
            </>
          ) : (
            "Your profile is hidden from the public site right now. You can still keep it up to date."
          )
        }
      />

      <section
        aria-labelledby="managed-heading"
        className="mb-8 rounded-3xl border border-line bg-sunken/60 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="managed-heading" className="text-sm font-semibold text-ink">
            {admin ? "Admin-only settings" : "Managed by your broker"}
          </h2>
          {admin ? (
            <Link
              href={`/dashboard/agents/${a.id}`}
              className="inline-flex min-h-10 items-center text-sm font-medium text-brand-700 hover:underline"
            >
              Edit full profile
            </Link>
          ) : (
            <p className="text-xs text-muted">Ask your broker if any of these need to change.</p>
          )}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-4">
          <Managed label="Visibility">
            {a.isActive ? (
              <span className="text-brand-800">Shown on the Agents page</span>
            ) : (
              <span className="text-clay-600">Hidden</span>
            )}
          </Managed>
          <Managed label="Profile URL">/agents/{a.slug}</Managed>
          <Managed label="Office">{row.officeName ?? "—"}</Managed>
          <Managed label="MLS agent ID">{a.mlsAgentId ?? "—"}</Managed>
        </dl>
      </section>

      <AgentForm mode="self" cancelHref="/dashboard" values={toAgentFormValues(a)} />
    </>
  );
}

function Managed({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-ink-soft">{children}</dd>
    </div>
  );
}

function NoProfile({ admin }: { admin: boolean }) {
  return (
    <>
      <PageHeader title="My profile" />
      <div className="mx-auto max-w-xl rounded-3xl border border-line bg-surface px-6 py-12 text-center shadow-card sm:px-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <UserRound className="size-7" />
        </span>
        <h2 className="mt-5 font-display-tight text-2xl text-ink">
          Your login isn&apos;t linked to an agent profile
        </h2>
        {admin ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              That&apos;s fine if you don&apos;t represent clients yourself. To appear on the public
              Agents page, add a profile for yourself, then link it to your login under Users &amp;
              roles.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton href="/dashboard/agents">Manage agents</LinkButton>
              <LinkButton href="/dashboard/users" variant="secondary">
                Users &amp; roles
              </LinkButton>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Once your broker links your login to your public profile, you can update your photo,
              bio, contact details and specialties here — and manage your listings and leads.
            </p>
            <LinkButton href="/dashboard" variant="secondary" className="mt-8">
              Back to overview
            </LinkButton>
          </>
        )}
      </div>
    </>
  );
}
