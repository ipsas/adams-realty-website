import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/auth-forms";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function SignUpPage(props: PageProps<"/sign-up">) {
  const next = safeNext((await props.searchParams).next);
  if (await getSession()) redirect(next);
  return (
    <AuthShell
      title="Create your account"
      subtitle="Free forever. Save homes, track price drops, and get instant alerts."
    >
      <SignUpForm next={next} googleEnabled={!!env.GOOGLE_CLIENT_ID} />
    </AuthShell>
  );
}
