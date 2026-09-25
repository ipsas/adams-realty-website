import type { Metadata } from "next";
import { PasswordForm, ProfileForm } from "@/components/account/account-forms";
import { Container } from "@/components/ui/section";
import { getSession, requireActor } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account", robots: { index: false } };

export default async function AccountPage() {
  await requireActor("/account");
  const session = (await getSession())!;
  const u = session.user;
  return (
    <Container className="max-w-3xl py-12">
      <h1 className="font-display-tight text-4xl font-normal text-ink">Account</h1>
      <div className="mt-10 grid gap-10">
        <section className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="mb-6 text-lg font-semibold text-ink">Profile</h2>
          <ProfileForm name={u.name} email={u.email} phone={u.phone ?? null} />
        </section>
        <section className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="mb-6 text-lg font-semibold text-ink">Password</h2>
          <PasswordForm />
        </section>
        <p className="text-sm text-muted">
          Want your account and data deleted? Email us and we&apos;ll take care of it within 7 days.
        </p>
      </div>
    </Container>
  );
}
