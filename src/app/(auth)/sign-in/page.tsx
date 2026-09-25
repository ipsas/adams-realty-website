import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/auth-forms";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormMessage } from "@/components/ui/form";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const REASONS: Record<string, string> = {
  save: "Sign in to save homes and see them on any device.",
  "save-search": "Sign in to save this search and get alerts.",
};

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const params = await props.searchParams;
  const next = safeNext(params.next);
  if (await getSession()) redirect(next);
  const reason = REASONS[String(params.reason ?? "")];
  return (
    <AuthShell title="Welcome back" subtitle={reason ?? "Sign in to your Adams Realty account."}>
      {params.reset && (
        <div className="mb-4">
          <FormMessage tone="success">
            Password updated — sign in with your new password.
          </FormMessage>
        </div>
      )}
      <SignInForm next={next} googleEnabled={!!env.GOOGLE_CLIENT_ID} />
    </AuthShell>
  );
}
