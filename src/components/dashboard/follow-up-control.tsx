"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { FOLLOW_UP_PRESETS, formatDay } from "@/lib/leads/working-hours";
import { setLeadFollowUp } from "@/server/actions/leads";

/**
 * A lead's "Follow up on" date (site review #9): a date field plus Tomorrow,
 * In 3 days and Next week. The quick buttons send the preset, and the server
 * counts the days in the market's time zone, so a phone set to another zone
 * can't shift the date. Due follow-ups appear under "Needs attention" and in
 * the morning email.
 */
export function FollowUpControl({
  inquiryId,
  followUpOn,
  today,
}: {
  inquiryId: string;
  followUpOn: string | null;
  /** The market's today (YYYY-MM-DD): the earliest date the field offers. */
  today: string;
}) {
  const [value, setValue] = useState(followUpOn ?? "");
  const [synced, setSynced] = useState(followUpOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Follow the server when it sends a new value (e.g. after a refresh).
  if (followUpOn !== synced) {
    setSynced(followUpOn);
    setValue(followUpOn ?? "");
  }

  const save = (next: string) => {
    const previous = value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(next) || next === "") setValue(next);
    setError(null);
    start(async () => {
      const res = await setLeadFollowUp(inquiryId, next).catch(() => null);
      if (!res?.ok) {
        setValue(previous);
        setError(res?.message ?? "Couldn't save. Please try again.");
      } else {
        setValue(res.followUpOn ?? "");
      }
    });
  };

  const due = value && value <= today;
  return (
    <div className="flex flex-col gap-1.5" data-testid="follow-up">
      <Label htmlFor="follow-up-on">Follow up on</Label>
      <Input
        id="follow-up-on"
        type="date"
        value={value}
        min={today}
        disabled={pending}
        onChange={(e) => save(e.target.value)}
        className="text-base sm:text-sm"
      />
      <div className="mt-1 flex flex-wrap gap-2">
        {FOLLOW_UP_PRESETS.map((p) => (
          <Button
            key={p.value}
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => save(p.value)}
          >
            {p.label}
          </Button>
        ))}
        {value && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => save("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs text-muted" role="status" data-testid="follow-up-status">
        {pending
          ? "Saving…"
          : value
            ? due
              ? `Due ${value === today ? "today" : formatDay(value)}: it's under Needs attention.`
              : `Set for ${formatDay(value)}.`
            : "No follow-up set."}
      </p>
      {error && (
        <p role="alert" className="text-xs text-clay-600">
          {error}
        </p>
      )}
    </div>
  );
}
