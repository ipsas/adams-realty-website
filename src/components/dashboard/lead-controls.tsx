"use client";

import { useTransition } from "react";
import {
  assignInquiry,
  changeUserRole,
  linkAgentProfile,
  runSourceSync,
  updateInquiryStatus,
} from "@/server/actions/dashboard";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const selectClass =
  "h-8 rounded-lg border border-line-strong bg-surface px-2 text-xs text-ink disabled:opacity-50";

export function LeadStatusSelect({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Lead status"
      defaultValue={status}
      disabled={pending}
      className={selectClass}
      onChange={(e) => start(() => void updateInquiryStatus(id, e.target.value))}
    >
      {["new", "contacted", "qualified", "closed", "spam"].map((s) => (
        <option key={s} value={s}>
          {s[0].toUpperCase() + s.slice(1)}
        </option>
      ))}
    </select>
  );
}

export function LeadAgentSelect({
  id,
  agentId,
  agents,
}: {
  id: string;
  agentId: string | null;
  agents: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Assigned agent"
      defaultValue={agentId ?? ""}
      disabled={pending}
      className={selectClass}
      onChange={(e) => start(() => void assignInquiry(id, e.target.value))}
    >
      <option value="">Unassigned</option>
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
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
