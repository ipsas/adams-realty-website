"use client";

import { Bell, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { formatDate } from "@/lib/format";
import { searchHref, type SearchCriteria } from "@/lib/search/params";
import { deleteSavedSearch, updateSavedSearchFrequency } from "@/server/actions/saved";

export function SavedSearchRow({
  search,
}: {
  search: {
    id: string;
    name: string;
    criteria: SearchCriteria;
    alertFrequency: string;
    createdAt: Date;
  };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <li
      className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5"
      aria-busy={pending}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Search className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={searchHref(search.criteria)}
          className="font-semibold text-ink hover:text-brand-700"
        >
          {search.name}
        </Link>
        <p className="text-xs text-muted">Saved {formatDate(search.createdAt)}</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <Bell className="size-4" />
        <select
          defaultValue={search.alertFrequency}
          disabled={pending}
          onChange={(e) =>
            startTransition(() => void updateSavedSearchFrequency(search.id, e.target.value))
          }
          className="h-9 rounded-full border border-line-strong bg-surface px-3 text-sm text-ink"
          aria-label="Email alerts"
        >
          <option value="instant">Instant alerts</option>
          <option value="daily">Daily digest</option>
          <option value="weekly">Weekly digest</option>
          <option value="off">No emails</option>
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => void deleteSavedSearch(search.id))}
        className="rounded-full p-2 text-muted hover:bg-clay-50 hover:text-clay-600"
        aria-label={`Delete saved search ${search.name}`}
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
