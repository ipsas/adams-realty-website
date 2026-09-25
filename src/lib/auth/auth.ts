import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { site } from "@/config/site";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";

export const auth = betterAuth({
  appName: site.name,
  baseURL: env.NEXT_PUBLIC_SITE_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      const email = passwordResetEmail({ name: user.name, url });
      await sendEmail({
        to: user.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    },
  },
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {},
  user: {
    additionalFields: {
      // `input: false` — nobody can choose their own role at sign-up. Roles
      // are changed only by admins through `changeUserRole` in src/server/actions/dashboard.ts.
      role: {
        type: ["user", "agent", "admin"],
        required: false,
        defaultValue: "user",
        input: false,
      },
      phone: { type: "string", required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // Signed cookie cache avoids a DB hit on every request. Role changes
    // therefore take up to this long to apply to an existing session.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
