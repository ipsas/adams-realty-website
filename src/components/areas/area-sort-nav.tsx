import Link from "next/link";
import { cn } from "@/lib/cn";
import type { AreaSort } from "@/lib/areas/stats";

const OPTIONS: { value: AreaSort; label: string }[] = [
  { value: "region", label: "By region" },
  { value: "homes", label: "Most homes" },
  { value: "price-high", label: "Price: high to low" },
  { value: "price-low", label: "Price: low to high" },
  { value: "name", label: "A–Z" },
];

/** URL-driven sort for /areas (works without JavaScript; the default stays at the canonical URL). */
export function AreaSortNav({ current }: { current: AreaSort }) {
  return (
    <nav aria-label="Sort area guides" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl bg-sunken p-1">
        {OPTIONS.map((o) => {
          const active = o.value === current;
          return (
            <li key={o.value}>
              <Link
                href={o.value === "region" ? "/areas" : `/areas?sort=${o.value}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex h-10 items-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-surface text-ink shadow-sm ring-1 ring-line"
                    : "text-muted hover:text-ink",
                )}
              >
                {o.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
