import { SyncButton } from "@/components/dashboard/lead-controls";
import { PageHeader } from "@/components/dashboard/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { cn } from "@/lib/cn";
import { getSources } from "@/lib/dashboard/queries";
import { formatNumber, formatRelative } from "@/lib/format";

export const metadata = { title: "MLS feeds" };

export default async function SourcesPage() {
  await requirePermission("/dashboard/sources", can.manageDataSources);
  const sources = await getSources();
  return (
    <>
      <PageHeader
        title="MLS feeds"
        description="Listing sources and sync health. Feeds sync automatically every 15 minutes; off-market listings are purged daily."
      />
      <div className="space-y-4">
        {sources.map((s) => (
          <section key={s.id} className="rounded-3xl border border-line bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-ink">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      s.isActive ? "bg-status-active" : "bg-faint",
                    )}
                  />
                  {s.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {s.kind === "manual" ? "Entered in this dashboard" : "RESO Web API"} ·{" "}
                  {formatNumber(s.listingCount)} listings
                  {s.lastSyncedAt && ` · last synced ${formatRelative(s.lastSyncedAt)}`}
                  {s.kind === "reso_web_api" && !s.isActive && " · inactive"}
                </p>
              </div>
              {s.kind === "reso_web_api" && (
                <SyncButton sourceId={s.id} disabled={!s.isActive || !s.config.baseUrl} />
              )}
            </div>
            {s.runs.length > 0 && (
              <ul className="mt-4 divide-y divide-line rounded-2xl border border-line text-sm">
                {s.runs.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
                  >
                    <span
                      className={cn(
                        "font-medium",
                        r.status === "failed"
                          ? "text-clay-600"
                          : r.status === "running"
                            ? "text-brass-700"
                            : "text-brand-700",
                      )}
                    >
                      {r.status}
                    </span>
                    <span className="text-muted">{formatRelative(r.startedAt)}</span>
                    <span className="text-ink-soft">
                      {r.fetched} fetched · {r.upserted} updated · {r.removed} removed
                    </span>
                    {r.error && (
                      <span className="w-full truncate text-xs text-clay-600">{r.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {s.kind === "reso_web_api" && !s.config.baseUrl && (
              <p className="mt-4 rounded-2xl bg-sunken px-4 py-3 text-xs leading-relaxed text-muted">
                Not connected yet. Once your IDX agreement with FMLS or Georgia MLS is approved, set
                this source&apos;s <code>config.baseUrl</code> and add its credentials as
                environment variables (see README → “Connecting your MLS”).
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
