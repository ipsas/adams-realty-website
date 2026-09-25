import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token } = await props.searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ResetPasswordForm token={typeof token === "string" ? token : null} />
    </AuthShell>
  );
}
