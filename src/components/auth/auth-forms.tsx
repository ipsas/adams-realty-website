"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/form";
import { Honeypot, useFormTimer } from "@/components/ui/spam-guard";
import { authClient } from "@/lib/auth/client";
import { FORM_TOKEN_FIELD, FORM_TOKEN_HEADER, HONEYPOT_FIELD } from "@/lib/spam";

function GoogleButton({ next }: { next: string }) {
  return (
    <>
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="size-5">
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24Z"
          />
          <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1Z" />
          <path
            fill="#EA4335"
            d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
          />
        </svg>
        Continue with Google
      </Button>
      <div className="my-6 flex items-center gap-3 text-xs text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

export function SignInForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {googleEnabled && <GoogleButton next={next} />}
      <form
        className="space-y-4"
        // Sent from onSubmit, not <form action>, so React doesn't reset what was typed.
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startTransition(async () => {
            setError(null);
            let result;
            try {
              result = await authClient.signIn.email({
                email: String(form.get("email")),
                password: String(form.get("password")),
                rememberMe: true,
              });
            } catch {
              // A network failure throws: say so inline rather than reach the error boundary.
              setError("Sign in failed.");
              return;
            }
            const { error } = result;
            if (error) {
              setError(
                error.status === 401
                  ? "That email and password don't match."
                  : (error.message ?? "Sign in failed."),
              );
              return;
            }
            // Replace, so Back from where they land skips the sign-in page.
            router.replace(next);
            router.refresh();
          });
        }}
      >
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Field
          label={
            <span className="flex w-full justify-between">
              Password
              <Link href="/forgot-password" className="font-normal text-brand-700 hover:underline">
                Forgot?
              </Link>
            </span>
          }
          htmlFor="password"
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <FormMessage>{error}</FormMessage>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link
          href={`/sign-up?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          Create a free account
        </Link>
      </p>
    </>
  );
}

export function SignUpForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stamp = useFormTimer();
  return (
    <>
      {googleEnabled && <GoogleButton next={next} />}
      <form
        className="space-y-4"
        // Sent from onSubmit, not <form action>, so React doesn't reset what was typed.
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startTransition(async () => {
            setError(null);
            const password = String(form.get("password"));
            if (password.length < 8) {
              setError("Use at least 8 characters for your password.");
              return;
            }
            let result;
            try {
              await stamp(form);
              result = await authClient.signUp.email({
                name: String(form.get("name")).trim(),
                email: String(form.get("email")).trim(),
                password,
                // Spam checks (src/lib/auth/sign-up-guard.ts): Better Auth owns the body.
                fetchOptions: {
                  headers: {
                    "x-form-hp": String(form.get(HONEYPOT_FIELD) ?? ""),
                    [FORM_TOKEN_HEADER]: String(form.get(FORM_TOKEN_FIELD) ?? ""),
                  },
                },
              });
            } catch {
              // A network failure throws: say so inline rather than reach the error boundary.
              setError("Couldn't create your account.");
              return;
            }
            const { error } = result;
            if (error) {
              setError(
                error.code === "USER_ALREADY_EXISTS" || error.status === 422
                  ? "An account with that email already exists. Try signing in."
                  : (error.message ?? "Couldn't create your account."),
              );
              return;
            }
            // Replace, so Back from where they land skips the sign-in page.
            router.replace(next);
            router.refresh();
          });
        }}
      >
        <Honeypot />
        <Field label="Full name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required minLength={2} autoFocus />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
        <FormMessage>{error}</FormMessage>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-xs leading-relaxed text-faint">
          We&apos;ll never sell your information or pass it to other agents.
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  if (sent) {
    return (
      <FormMessage tone="success">
        If an account exists for that email, a reset link is on its way. It expires in one hour.
      </FormMessage>
    );
  }
  return (
    <form
      className="space-y-4"
      action={(form) =>
        startTransition(async () => {
          // Always report success so the form can't be used to discover accounts.
          await authClient.requestPasswordReset({
            email: String(form.get("email")),
            redirectTo: "/reset-password",
          });
          setSent(true);
        })
      }
    >
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!token) {
    return (
      <FormMessage>
        This reset link is invalid or has expired.{" "}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </FormMessage>
    );
  }
  return (
    <form
      className="space-y-4"
      action={(form) =>
        startTransition(async () => {
          const newPassword = String(form.get("password"));
          if (newPassword.length < 8) return setError("Use at least 8 characters.");
          const { error } = await authClient.resetPassword({ newPassword, token });
          if (error) return setError("This reset link is invalid or has expired.");
          router.push("/sign-in?reset=1");
        })
      }
    >
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
        />
      </Field>
      <FormMessage>{error}</FormMessage>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
