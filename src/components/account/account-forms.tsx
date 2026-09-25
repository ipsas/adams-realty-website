"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/cn";
import { setHomeAlerts } from "@/server/actions/alerts";

type Status = { tone: "success" | "error"; text: string } | null;

export function ProfileForm({
  name,
  email,
  phone,
}: {
  name: string;
  email: string;
  phone: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-4"
      action={(form) =>
        startTransition(async () => {
          const { error } = await authClient.updateUser({
            name: String(form.get("name")).trim(),
            phone: String(form.get("phone")).trim() || null,
          });
          setStatus(
            error
              ? { tone: "error", text: error.message ?? "Couldn't save." }
              : { tone: "success", text: "Saved." },
          );
          router.refresh();
        })
      }
    >
      <Field label="Name" htmlFor="name">
        <Input
          id="name"
          name="name"
          defaultValue={name}
          required
          minLength={2}
          autoComplete="name"
        />
      </Field>
      <Field label="Email" htmlFor="email" hint="Contact us to change the email on your account.">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <Field
        label="Phone"
        htmlFor="phone"
        hint="Optional — so your agent can text you about tours."
      >
        <Input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} autoComplete="tel" />
      </Field>
      {status && <FormMessage tone={status.tone}>{status.text}</FormMessage>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-4"
      action={(form) =>
        startTransition(async () => {
          const newPassword = String(form.get("newPassword"));
          if (newPassword.length < 8)
            return setStatus({ tone: "error", text: "Use at least 8 characters." });
          const { error } = await authClient.changePassword({
            currentPassword: String(form.get("currentPassword")),
            newPassword,
            revokeOtherSessions: true,
          });
          setStatus(
            error
              ? { tone: "error", text: "Your current password is incorrect." }
              : { tone: "success", text: "Password changed. Other devices were signed out." },
          );
        })
      }
    >
      <Field label="Current password" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" htmlFor="newPassword" hint="At least 8 characters.">
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      {status && <FormMessage tone={status.tone}>{status.text}</FormMessage>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}

/** On/off switch for price and status emails about the user's saved homes (users.home_alerts). */
export function HomeAlertsToggle({
  enabled: initial,
  savedCount,
}: {
  enabled: boolean;
  savedCount: number;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [status, setStatus] = useState<Status>(null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    // aria-disabled rather than `disabled` while saving, so keyboard focus stays on the switch.
    if (pending) return;
    const next = !enabled;
    setEnabled(next);
    setStatus(null);
    startTransition(async () => {
      const result = await setHomeAlerts(next).catch(() => null);
      if (!result?.ok) {
        setEnabled(!next);
        setStatus({ tone: "error", text: result?.error ?? "Couldn't save. Please try again." });
      } else {
        setStatus({
          tone: "success",
          text: next ? "Saved-home updates are on." : "Saved-home updates are off.",
        });
      }
    });
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p id="home-alerts-label" className="font-medium text-ink">
            Saved homes
          </p>
          <p id="home-alerts-hint" className="mt-0.5 text-sm text-muted">
            Email me when a home I&apos;ve saved drops in price, goes under contract, sells or comes
            back on the market.
            {savedCount > 0 && ` You have ${savedCount} saved.`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="home-alerts-label"
          aria-describedby="home-alerts-hint"
          aria-disabled={pending || undefined}
          onClick={toggle}
          className="group -m-1.5 flex shrink-0 items-center rounded-full p-1.5 aria-disabled:cursor-wait aria-disabled:opacity-60"
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
