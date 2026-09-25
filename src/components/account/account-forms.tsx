"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";

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
