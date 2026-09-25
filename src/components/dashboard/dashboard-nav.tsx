"use client";

import {
  Building2,
  CircleUserRound,
  Contact,
  Database,
  Inbox,
  LayoutDashboard,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export function DashboardNav({
  admin,
  hasAgentProfile,
}: {
  admin: boolean;
  hasAgentProfile: boolean;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // On phones the nav is a horizontal strip; keep the current section in view.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    nav.scrollLeft += box.left - navBox.left - (navBox.width - box.width) / 2;
  }, [pathname]);

  const items = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    {
      href: "/dashboard/listings",
      label: admin ? "Company listings" : "My listings",
      icon: Building2,
    },
    { href: "/dashboard/leads", label: "Leads", icon: Inbox },
    ...(hasAgentProfile
      ? [{ href: "/dashboard/profile", label: "My profile", icon: CircleUserRound }]
      : []),
    ...(admin
      ? [
          { href: "/dashboard/agents", label: "Agents", icon: Contact },
          { href: "/dashboard/users", label: "Users & roles", icon: Users },
          { href: "/dashboard/sources", label: "MLS feeds", icon: Database },
        ]
      : []),
  ];
  return (
    <aside className="border-b border-line lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
      <nav
        ref={navRef}
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
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
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
            can manage listings and your public profile.
          </p>
        )}
      </nav>
    </aside>
  );
}
