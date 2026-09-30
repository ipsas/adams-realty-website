"use client";

import { useId, useState, useTransition } from "react";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { setEmailSetting, type EmailSetting } from "@/server/actions/staff-settings";

/**
 * One on/off switch on Dashboard → Email settings. Saves as soon as it's
 * flipped and rolls back if the save fails.
 */
export function EmailSettingSwitch({
  setting,
  enabled: initial,
  label,
  hint,
  onText,
  offText,
}: {
  setting: EmailSetting;
  enabled: boolean;
  label: string;
  hint: string;
  onText: string;
  offText: string;
}) {
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    // aria-disabled rather than `disabled` while saving, so keyboard focus stays on the switch.
    if (pending) return;
    const next = !enabled;
    setEnabled(next);
    setStatus(null);
    startTransition(async () => {
      const result = await setEmailSetting(setting, next).catch(() => null);
      if (!result?.ok) {
        setEnabled(!next);
        setStatus({ tone: "error", text: result?.error ?? "Couldn't save. Please try again." });
      } else {
        setStatus({ tone: "success", text: next ? onText : offText });
      }
    });
  };

  return (
    <div className="py-5 first:pt-0 last:pb-0" data-testid={`setting-${setting}`}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p id={`${id}-label`} className="font-medium text-ink">
            {label}
          </p>
          <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted">
            {hint}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          aria-disabled={pending || undefined}
          onClick={toggle}
          className="group -m-1.5 flex min-h-11 shrink-0 items-center rounded-full p-1.5 aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          <span
            className={cn(
              "relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200",
              enabled ? "bg-primary" : "bg-line-strong",
            )}
          >
            <span
              className={cn(
                "inline-block size-5.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
                enabled ? "translate-x-[1.4375rem]" : "translate-x-[0.1875rem]",
              )}
            />
          </span>
        </button>
      </div>
      {status && (
        <div className="mt-3">
          <FormMessage tone={status.tone}>{status.text}</FormMessage>
        </div>
      )}
    </div>
  );
}
