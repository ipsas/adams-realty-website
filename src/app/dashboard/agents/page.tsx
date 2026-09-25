import { ExternalLink, UserPlus } from "lucide-react";
import Link from "next/link";
import { AgentActiveButton } from "@/components/dashboard/agent-form";
import { PageHeader, Table, Td, Th } from "@/components/dashboard/ui";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import { getAgentsForAdmin } from "@/lib/agents/admin-queries";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";

export const metadata = { title: "Agents" };

export default async function AgentsAdminPage() {
  await requirePermission("/dashboard/agents", can.manageAgents);
  const rows = await getAgentsForAdmin();
  const active = rows.filter((r) => r.isActive).length;
  const inactive = rows.length - active;

  return (
    <>
      <PageHeader
        title="Agents"
        description={
          <>
            {active} active{inactive > 0 && ` · ${inactive} inactive`}. Active agents appear on the
            public{" "}
            <Link href="/agents" className="font-medium text-brand-700 hover:underline">
              Agents page
            </Link>{" "}
            in sort order. Link a profile to a login under{" "}
            <Link href="/dashboard/users" className="font-medium text-brand-700 hover:underline">
              Users &amp; roles
            </Link>
            .
          </>
        }
        action={
          <LinkButton href="/dashboard/agents/new">
            <UserPlus /> Add agent
          </LinkButton>
        }
      />
      {rows.length === 0 ? (
        <div className="rounded-2xl bg-sunken px-5 py-12 text-center">
          <p className="font-medium text-ink">No agent profiles yet</p>
          <p className="mt-1 text-sm text-muted">
            Add your first agent to show them on the public Agents page.
          </p>
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Contact</Th>
              <Th>Login</Th>
              <Th className="text-right">Active listings</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-sunken/40">
                <Td>
                  <Link
                    href={`/dashboard/agents/${a.id}`}
                    className={cn("group flex items-center gap-3", !a.isActive && "opacity-60")}
                  >
                    <Avatar
                      src={a.photoUrl}
                      name={a.name}
                      className="size-10 shrink-0 rounded-full text-sm"
                    />
                    <span className="max-w-48 min-w-0">
                      <span className="block truncate font-medium text-ink group-hover:text-brand-700">
                        {a.name}
                      </span>
                      <span className="block truncate text-xs">{a.title ?? "—"}</span>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <a
                    href={`mailto:${a.email}`}
                    className="block max-w-56 truncate hover:text-ink"
                    title={a.email}
                  >
                    {a.email}
                  </a>
                  <span className="block text-xs tabular">{a.phone ?? "No phone"}</span>
                </Td>
                <Td>
                  {a.loginEmail ? (
                    <span className="block max-w-48 truncate text-xs" title={a.loginEmail}>
                      {a.loginEmail}
                    </span>
                  ) : (
                    <span className="text-xs text-faint">Not linked</span>
                  )}
                </Td>
                <Td className="text-right text-ink tabular">{a.activeListings}</Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      a.isActive ? "bg-brand-50 text-brand-800" : "bg-sunken text-muted",
                    )}
                  >
                    {a.isActive ? "Active" : "Inactive"}
                  </span>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {a.isActive && (
                    <Link
                      href={`/agents/${a.slug}`}
                      title="View public profile"
                      aria-label={`View ${a.name}'s public profile`}
                      className="inline-flex size-10 items-center justify-center rounded-lg align-middle text-muted hover:bg-sunken hover:text-ink"
                    >
                      <ExternalLink className="size-4" />
                    </Link>
                  )}
                  <Link
                    href={`/dashboard/agents/${a.id}`}
                    className="inline-flex h-10 items-center rounded-lg px-2 text-sm font-medium text-brand-700 hover:underline"
                  >
                    Edit
                  </Link>
                  <AgentActiveButton id={a.id} name={a.name} active={a.isActive} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
