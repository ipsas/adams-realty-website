import type { Metadata } from "next";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { EmailNotConfiguredNotice } from "@/components/dashboard/email-notice";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { emailConfigured } from "@/lib/email";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Dashboard" },
  robots: { index: false },
};

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const actor = await requirePermission("/dashboard", can.viewDashboard);
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col lg:flex-row">
      <DashboardNav admin={actor.role === "admin"} hasAgentProfile={!!actor.agentId} />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10">
        <EmailNotConfiguredNotice configured={emailConfigured()} />
        {children}
      </main>
    </div>
  );
}
