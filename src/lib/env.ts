import { z } from "zod";

/**
 * Server-side environment, validated once at startup. Client code must only
 * read `NEXT_PUBLIC_*` variables directly — never import this module there.
 */
const isProduction = process.env.NODE_ENV === "production";
// `next build` evaluates modules without runtime secrets; validate at runtime instead.
const skipValidation =
  process.env.SKIP_ENV_VALIDATION === "1" || process.env.NEXT_PHASE === "phase-production-build";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const makeSchema = (strict: boolean) =>
  z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: strict
      ? z.string().url()
      : z.string().url().default("postgres://adams:adams@localhost:5432/adams_realty"),
    BETTER_AUTH_SECRET: strict
      ? z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
      : z.string().default("dev-only-secret-change-me-dev-only-secret"),
    NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    /** Bearer token Vercel Cron (or any scheduler) sends to /api/cron/*. */
    CRON_SECRET: optional,
    /** Transactional email via Resend. Without it, emails are logged to the console. */
    RESEND_API_KEY: optional,
    EMAIL_FROM: z.string().default("Adams Realty <hello@example.com>"),
    /** Where new-lead notifications go when a lead has no assigned agent. */
    LEADS_INBOX: optional,
  });

export type Env = z.infer<ReturnType<typeof makeSchema>>;

function parseEnv(): Env {
  // Outside production, missing values fall back to local-dev defaults.
  const parsed = makeSchema(isProduction && !skipValidation).safeParse(process.env);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parseEnv();
