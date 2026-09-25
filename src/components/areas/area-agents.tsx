import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import type { AreaAgent } from "@/lib/areas/queries";

/** Agents who name the area among their service areas. */
export function AreaAgents({ agents, areaName }: { agents: AreaAgent[]; areaName: string }) {
  if (!agents.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong p-6 text-sm leading-relaxed text-muted">
        Any of our agents can help you buy or sell in {areaName}.{" "}
        <Link href="/agents" className="font-medium text-brand-700 hover:underline">
          Meet the team
        </Link>
        .
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {agents.map((a) => (
        <li key={a.id}>
          <Link
            href={`/agents/${a.slug}`}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-shadow hover:shadow-card"
          >
            <Avatar
              src={a.photoUrl}
              name={a.name}
              className="size-14 shrink-0 rounded-full text-lg"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink group-hover:text-brand-700">{a.name}</p>
              {a.title && <p className="truncate text-sm text-muted">{a.title}</p>}
              <p className="mt-0.5 text-xs font-medium text-brand-700">
                {a.listingsHere > 0
                  ? `${a.listingsHere} ${a.listingsHere === 1 ? "listing" : "listings"} in ${areaName}`
                  : `Works in ${areaName}`}
              </p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
