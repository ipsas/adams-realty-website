"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { searchHref, type SearchMode } from "@/lib/search/params";
import { LocationSearch } from "./location-search";

const MODES: { value: SearchMode; label: string }[] = [
  { value: "buy", label: "Buy" },
  { value: "rent", label: "Rent" },
  { value: "sold", label: "Sold" },
];

export function HeroSearch() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>("buy");
  return (
    <div className="w-full max-w-2xl">
      <div role="tablist" aria-label="Search type" className="mb-3 flex gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            role="tab"
            type="button"
            aria-selected={mode === m.value}
            onClick={() => setMode(m.value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              mode === m.value
                ? "bg-white text-ink shadow-sm"
                : "text-white/80 hover:bg-white/10 hover:text-white",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <LocationSearch
        size="lg"
        onSearch={(q) => router.push(searchHref({ mode, q: q || undefined }))}
        placeholder="Search a town, ZIP or address"
      />
    </div>
  );
}
