import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AgentForm } from "@/components/dashboard/agent-form";
import { PageHeader } from "@/components/dashboard/ui";
import { getAgentForEdit, getOfficeOptions, toAgentFormValues } from "@/lib/agents/admin-queries";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { CreatedNotice } from "./created-notice";

export const metadata = { title: "Edit agent" };

export default async function EditAgentPage(props: PageProps<"/dashboard/agents/[id]">) {
  const { id } = await props.params;
  const { created } = await props.searchParams;
  await requirePermission(`/dashboard/agents/${id}`, can.manageAgents);
  if (!z.uuid().safeParse(id).success) notFound();
  const [row, offices] = await Promise.all([getAgentForEdit(id), getOfficeOptions()]);
  if (!row) notFound();
  const a = row.agent;

  return (
    <>
      <Link
        href="/dashboard/agents"
        className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> All agents
      </Link>
      <PageHeader
        title={a.name}
        description={
          <>
            {a.isActive ? (
              <Link
                href={`/agents/${a.slug}`}
                className="font-medium text-brand-700 hover:underline"
              >
                View public page
              </Link>
            ) : (
              <span className="font-medium text-clay-600">Hidden from the public site</span>
            )}
            {" · "}
            {row.loginEmail ? (
              <>Login: {row.loginEmail}</>
            ) : (
              <>
                No login linked —{" "}
                <Link
                  href="/dashboard/users"
                  className="font-medium text-brand-700 hover:underline"
                >
                  link one in Users &amp; roles
                </Link>
              </>
            )}
          </>
        }
      />
      <AgentForm
        mode="edit"
        cancelHref="/dashboard/agents"
        offices={offices}
        values={toAgentFormValues(a)}
        notice={
          created && (
            <CreatedNotice>
              Profile created
              {a.isActive ? (
                <>
                  {" "}
                  — it&apos;s live at{" "}
                  <Link href={`/agents/${a.slug}`} className="font-medium underline">
                    /agents/{a.slug}
                  </Link>
                  .
                </>
              ) : (
                ". It stays hidden until you mark it active."
              )}
            </CreatedNotice>
          )
        }
      />
    </>
  );
}
