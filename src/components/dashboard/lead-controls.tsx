"use client";

import { ChevronDown } from "lucide-react";
import { useState, useTransition, type ChangeEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  assignInquiry,
  changeUserRole,
  linkAgentProfile,
  runSourceSync,
  updateInquiryStatus,
} from "@/server/actions/dashboard";

const selectClass =
  "h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs text-ink disabled:opacity-50";

const LEAD_STATUS_OPTIONS = ["new", "contacted", "qualified", "closed", "spam"];

// 40px tall for touch, and 16px text on phones so iOS doesn't zoom in.
const leadSelectClass = {
  sm: "h-10 max-w-44 rounded-lg border border-line-strong bg-surface px-2 text-base text-ink disabled:opacity-50 sm:text-[0.8125rem]",
  md: "h-11 w-full appearance-none rounded-xl border border-line-strong bg-surface pr-10 pl-3.5 text-base text-ink transition-colors outline-none hover:border-faint focus:border-brand-500 focus:ring-3 focus:ring-brand-100 disabled:opacity-60 sm:text-sm",
};

/**
 * Lead controls come in two sizes: `sm` for inline table cells and `md` for
 * form layouts such as the lead detail page (full width). `selectId` lets a
 * visible <label> point at the select.
 */
type LeadControlProps = { size?: "sm" | "md"; selectId?: string };

/**
 * A controlled value that follows its prop when the server sends a new one
 * (e.g. a note just marked the lead contacted), and can be set locally meanwhile.
 */
function useServerValue(value: string) {
  const [current, setCurrent] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setCurrent(value);
  }
  return [current, setCurrent] as const;
}

function LeadSelect({
  size = "sm",
  selectId,
  label,
  value,
  pending,
  onChange,
  children,
}: LeadControlProps & {
  label: string;
  value: string;
  pending: boolean;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  const select = (
    <select
      id={selectId}
      aria-label={label}
      value={value}
      disabled={pending}
      onChange={onChange}
      className={leadSelectClass[size]}
    >
      {children}
    </select>
  );
  if (size === "sm") return select;
  return (
    <div className="relative">
      {select}
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

export function LeadStatusSelect({
  id,
  status,
  ...rest
}: LeadControlProps & { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useServerValue(status);
  return (
    <LeadSelect
      {...rest}
      label="Lead status"
      value={value}
      pending={pending}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(async () => {
          const res = await updateInquiryStatus(id, next);
          if (!res.ok) setValue(status);
        });
      }}
    >
      {LEAD_STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s[0].toUpperCase() + s.slice(1)}
        </option>
      ))}
    </LeadSelect>
  );
}

export function LeadAgentSelect({
  id,
  agentId,
  agents,
  ...rest
}: LeadControlProps & {
  id: string;
  agentId: string | null;
  agents: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useServerValue(agentId ?? "");
  return (
    <LeadSelect
      {...rest}
      label="Assigned agent"
      value={value}
      pending={pending}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        start(async () => {
          await assignInquiry(id, next);
        });
      }}
    >
      <option value="">Unassigned</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </LeadSelect>
  );
}

export function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Role"
      defaultValue={role}
      disabled={disabled || pending}
      className={selectClass}
      onChange={(e) => start(() => void changeUserRole(userId, e.target.value))}
    >
      <option value="user">Shopper</option>
      <option value="agent">Agent</option>
      <option value="admin">Admin / broker</option>
    </select>
  );
}

export function AgentLinkSelect({
  userId,
  agentId,
  agents,
}: {
  userId: string;
  agentId: string | null;
  agents: { id: string; name: string; userId: string | null }[];
}) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Agent profile"
      defaultValue={agentId ?? ""}
      disabled={pending}
      className={selectClass}
      onChange={(e) => start(() => void linkAgentProfile(userId, e.target.value))}
    >
      <option value="">— Not linked —</option>
      {agents
        .filter((a) => !a.userId || a.userId === userId)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </select>
  );
}

export function SyncButton({ sourceId, disabled }: { sourceId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const res = await runSourceSync(sourceId);
            setMessage(res.message ?? null);
          })
        }
      >
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
