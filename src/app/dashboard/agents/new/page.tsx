import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AgentForm } from "@/components/dashboard/agent-form";
import { PageHeader } from "@/components/dashboard/ui";
import { getNextSortOrder, getOfficeOptions } from "@/lib/agents/admin-queries";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const metadata = { title: "Add agent" };

export default async function NewAgentPage() {
  await requirePermission("/dashboard/agents/new", can.manageAgents);
  const [offices, sortOrder] = await Promise.all([getOfficeOptions(), getNextSortOrder()]);
  return (
    <>
      <BackLink />
      <PageHeader
        title="Add agent"
        description="Creates a public profile on the Agents page. Once they have a login, link it under Users & roles so they can manage their own listings and profile."
      />
      <AgentForm
        mode="create"
        cancelHref="/dashboard/agents"
        offices={offices}
        values={{
          name: "",
          slug: "",
          title: null,
          email: "",
          phone: null,
          bio: null,
          photoUrl: null,
          licenseNumber: null,
          mlsAgentId: null,
          specialties: [],
          languages: [],
          serviceAreas: [],
          yearsExperience: null,
          // With a single office (the usual case) there's nothing to choose.
          officeId: offices.length === 1 ? offices[0]!.id : null,
          isActive: true,
          sortOrder,
        }}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/agents"
      className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
    >
      <ArrowLeft className="size-4" /> All agents
    </Link>
  );
}
