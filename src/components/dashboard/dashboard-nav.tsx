"use client";

import { Building2, Database, Inbox, LayoutDashboard, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function DashboardNav({
  admin,
  hasAgentProfile,
}: {
  admin: boolean;
  hasAgentProfile: boolean;
}) {
  const pathname = usePathname();
  const items = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    {
      href: "/dashboard/listings",
      label: admin ? "Company listings" : "My listings",
      icon: Building2,
    },
    { href: "/dashboard/leads", label: "Leads", icon: Inbox },
    ...(admin
      ? [
          { href: "/dashboard/users", label: "Users & roles", icon: Users },
          { href: "/dashboard/sources", label: "MLS feeds", icon: Database },
        ]
      : []),
  ];
  return (
    <aside className="border-b border-line lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
      <nav
        className="scrollbar-none flex gap-1 overflow-x-auto px-4 py-3 lg:sticky lg:top-16 lg:flex-col lg:px-4 lg:py-8"
        aria-label="Dashboard"
      >
        <p className="mb-2 hidden px-3 text-xs font-semibold tracking-widest text-faint uppercase lg:block">
          {admin ? "Broker tools" : "Agent tools"}
        </p>
        {items.map((item) => {
          const active =
            item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-brand-50 text-brand-800"
                  : "text-ink-soft hover:bg-sunken hover:text-ink",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
        {!admin && !hasAgentProfile && (
          <p className="mt-4 hidden rounded-xl bg-brass-100 px-3 py-2 text-xs text-brass-700 lg:block">
            Your login isn&apos;t linked to an agent profile yet. Ask your broker to link it so you
            can manage listings.
          </p>
        )}
      </nav>
    </aside>
  );
}
