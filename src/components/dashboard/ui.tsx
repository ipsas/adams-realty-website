import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { parseSpamReasons, SPAM_REASON_LABELS } from "@/lib/spam";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display-tight text-3xl font-normal text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-2xl border border-line bg-surface", className)}>
      <table className="w-full min-w-[720px] text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "border-b border-line bg-sunken/60 px-4 py-3 text-left text-xs font-medium tracking-wide text-muted uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-line px-4 py-3 align-middle text-ink-soft", className)}>
      {children}
    </td>
  );
}

const LEAD_TONES: Record<string, string> = {
  new: "bg-brand-50 text-brand-800",
  contacted: "bg-brass-100 text-brass-700",
  qualified: "bg-status-soon/10 text-status-soon",
  closed: "bg-sunken text-muted",
  spam: "bg-clay-50 text-clay-600",
};

export function LeadTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    tour: "Tour",
    question: "Question",
    offer: "Offer",
    valuation: "Valuation",
    general: "General",
  };
  return (
    <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-soft">
      {labels[type] ?? type}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", LEAD_TONES[status])}
    >
      {status}
    </span>
  );
}

/**
 * Marks a lead the spam check flagged (src/lib/spam.ts) while it sits in Spam, with
 * the reasons. Moving it to another status clears the badge.
 */
export function SpamFlag({ reasons, status }: { reasons: string | null; status: string }) {
  const parsed = parseSpamReasons(reasons);
  if (status !== "spam" || parsed.length === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-clay-50 px-2 py-0.5 text-xs font-medium text-clay-600"
      title={parsed.map((r) => SPAM_REASON_LABELS[r]).join("; ")}
      data-testid="spam-flag"
    >
      <ShieldAlert className="size-3.5" aria-hidden />
      Flagged automatically
    </span>
  );
}
