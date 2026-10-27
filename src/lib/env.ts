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

/**
 * On Vercel, fall back to the deployment's own URL so preview deployments work
 * without configuring NEXT_PUBLIC_SITE_URL. Never in production: a deploy host
 * there would become the canonical URL, so production must set NEXT_PUBLIC_SITE_URL.
 */
export function vercelSiteUrl(
  e: Record<string, string | undefined> = process.env,
): string | undefined {
  if (e.VERCEL_ENV === "production") return undefined;
  const host = e.VERCEL_BRANCH_URL ?? e.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/** Every origin this deployment is reachable at, for auth origin checks. */
export function vercelOrigins(e: Record<string, string | undefined> = process.env): string[] {
  return [e.VERCEL_URL, e.VERCEL_BRANCH_URL, e.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((h): h is string => !!h)
    .map((h) => `https://${h}`);
}

/** The site's origin, without trailing slashes (callers append paths). */
const siteUrl = z
  .string()
  .url()
  .transform((v) => v.replace(/\/+$/, ""));

/** Exported for tests. */
export const makeSchema = (strict: boolean, e: Record<string, string | undefined> = process.env) =>
  z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: strict
      ? z.string().url()
      : z.string().url().default("postgres://adams:adams@localhost:5432/adams_realty"),
    BETTER_AUTH_SECRET: strict
      ? z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
      : z.string().default("dev-only-secret-change-me-dev-only-secret"),
    // Required only on Vercel production: NODE_ENV is also "production" on previews and in
    // local `next build`, and those keep the deployment/localhost fallback.
    NEXT_PUBLIC_SITE_URL:
      e.VERCEL_ENV === "production"
        ? z.string({ error: "NEXT_PUBLIC_SITE_URL is required in production" }).pipe(siteUrl)
        : siteUrl.default(vercelSiteUrl(e) ?? "http://localhost:3000"),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    /** Bearer token Vercel Cron (or any scheduler) sends to /api/cron/*. */
    CRON_SECRET: optional,
    /**
     * Transactional email via Resend. Optional so the app still boots without it, but then no
     * email is sent: sendEmail reports `email_not_configured`.
     */
    RESEND_API_KEY: optional,
    EMAIL_FROM: z.string().default("Adams Realty <hello@example.com>"),
    /** Reply-To for emails that don't set their own (e.g. the office inbox). Unset: none. */
    EMAIL_REPLY_TO: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.string().email().optional()),
    /** Where new-lead notifications go when a lead has no assigned agent. */
    LEADS_INBOX: optional,
    /**
     * The office's internet addresses, comma-separated (IPv4 CIDR ranges allowed).
     * The anti-scraping limiter never limits them. Empty by default.
     */
    OFFICE_IPS: optional,
    /**
     * Demo-data mode (noindex on the sample listings and the guides, places and agent pages
     * that show them): `on`/`off`.
     * Unset, it follows SEED_DEMO_DATA. Read per request by src/lib/demo-mode.ts.
     */
    DEMO_DATA_MODE: optional,
    /**
     * Which listing pages search engines may index: `area` (default: the firm's own and those
     * in its area, also the listing sitemaps) or `none`. Anything else means `none`.
     * Read per request by src/lib/listings/indexing.ts.
     */
    LISTINGS_INDEXING: optional,
    /**
     * Preview gate (src/lib/preview-gate.ts): while set, only visitors who have entered this
     * shared password on /preview see the site; everyone else gets the coming-soon page.
     * Unset or empty, the site is open. Changing it signs every browser out of the preview.
     * Read per request by the gate, like DEMO_DATA_MODE.
     */
    PREVIEW_PASSWORD: optional,
    /**
     * Bearer token for the Georgia MLS feed (Bridge RESO Web API). The provider reads it
     * through the source's credentialsEnvPrefix ("MLS_GAMLS"); unset, the sync skips the feed.
     */
    MLS_GAMLS_TOKEN: optional,
    /** Bridge dataset name of the Georgia MLS feed; no default (e.g. "test" for Bridge's demo data). */
    MLS_GAMLS_DATASET: optional,
    /**
     * Georgia MLS office ID (ListOfficeMlsId). With MLS_GAMLS_SCOPE "statewide" it limits the
     * feed to that office; with "area" it adds that office's listings outside the area.
     */
    MLS_GAMLS_OFFICE_ID: optional,
    /**
     * Georgia MLS feed geography: "statewide" (default) or "area" (the firm's counties). Read
     * by gamlsFilter (src/lib/mls/gamls.ts), which throws on any other value.
     */
    MLS_GAMLS_SCOPE: optional,
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
