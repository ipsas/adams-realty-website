import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { site } from "@/config/site";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { env, vercelOrigins } from "@/lib/env";
import { sendPasswordReset } from "./reset-email";
import { checkSignUp } from "./sign-up-guard";

export const auth = betterAuth({
  appName: site.name,
  baseURL: env.NEXT_PUBLIC_SITE_URL,
  // A Vercel deployment answers on several hostnames (deployment, branch, production).
  trustedOrigins: [env.NEXT_PUBLIC_SITE_URL, ...vercelOrigins()],
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
      await sendPasswordReset({ user, url });
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
  hooks: {
    // Spam checks on email sign-up (honeypot, timer, per-IP and per-email limits).
    // Only for HTTP requests: server-side calls (none today) aren't forms.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email" || !ctx.request) return;
      const body = ctx.body as { email?: unknown } | undefined;
      const email = typeof body?.email === "string" ? body.email : null;
      const verdict = await checkSignUp(db, ctx.request.headers, email);
      if (!verdict.ok) throw new APIError(verdict.status, { message: verdict.message });
    }),
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
