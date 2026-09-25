import { Check, ExternalLink, Pencil, UserPlus } from "lucide-react";
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

const iconLink =
  "inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink";

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
        // Fits beside the sidebar from lg up, so the shared 720px minimum is lifted
        // there (phones scroll the table instead). Text caps grow with the screen,
        // the Login column joins at xl, and the narrowest band drops the
        // public-profile shortcut (it's also on the edit page).
        <Table className="lg:[&>table]:min-w-0">
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Contact</Th>
              <Th className="hidden xl:table-cell">Login</Th>
              <Th className="px-3 text-right">
                <span title="Active and coming-soon listings">Listings</span>
              </Th>
              <Th className="px-3">Status</Th>
              {/* `relative` keeps the visually hidden label inside the scrolling table. */}
              <Th className="relative">
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
                    className="group flex items-center gap-3"
                  >
                    <span
                      aria-hidden
                      className={cn("flex shrink-0", !a.isActive && "opacity-50 grayscale")}
                    >
                      <Avatar
                        src={a.photoUrl}
                        name={a.name}
                        className="size-10 rounded-full text-sm"
                      />
                    </span>
                    <span className="max-w-36 min-w-0 min-[1152px]:max-w-40 xl:max-w-48 2xl:max-w-56">
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
                    className="block max-w-36 truncate hover:text-ink min-[1152px]:max-w-56 2xl:max-w-64"
                    title={a.email}
                  >
                    {a.email}
                  </a>
                  <span className="block text-xs tabular">{a.phone ?? "No phone"}</span>
                </Td>
                <Td className="hidden xl:table-cell">
                  {a.loginEmail ? (
                    <span
                      className="flex items-center gap-1.5 text-xs"
                      title={`Signs in as ${a.loginEmail}`}
                    >
                      <Check aria-hidden className="size-3.5 shrink-0 text-brand-700" />
                      <span className="2xl:hidden">Linked</span>
                      <span className="hidden max-w-56 truncate 2xl:block">{a.loginEmail}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Not linked</span>
                  )}
                </Td>
                <Td className="px-3 text-right text-ink tabular">{a.activeListings}</Td>
                <Td className="px-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                      a.isActive ? "bg-brand-50 text-brand-800" : "bg-sunken text-muted",
                    )}
                  >
                    {a.isActive ? "Active" : "Inactive"}
                  </span>
                </Td>
                <Td className="px-2">
                  <div className="flex items-center justify-end">
                    {a.isActive && (
                      <Link
                        href={`/agents/${a.slug}`}
                        title="View public profile"
                        aria-label={`View ${a.name}'s public profile`}
                        className={cn(iconLink, "lg:max-[1152px]:hidden")}
                      >
                        <ExternalLink className="size-4" />
                      </Link>
                    )}
                    <Link
                      href={`/dashboard/agents/${a.id}`}
                      title="Edit profile"
                      aria-label={`Edit ${a.name}`}
                      className={iconLink}
                    >
                      <Pencil className="size-4" />
                    </Link>
                    <AgentActiveButton id={a.id} name={a.name} active={a.isActive} />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
