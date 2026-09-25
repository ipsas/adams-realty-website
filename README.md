# Adams Realty

The website for **Adams Realty, Inc.** (Georgia): home search that's faster,
cleaner and more honest than the big portals. It has no ads, never sells leads,
and every listing shows its true monthly cost.

- **Search:** URL-driven filters, full-text and map search, clustered price-pin map, saved searches with alerts
- **Listing pages:** photo gallery, full monthly-cost calculator, price history, schools, map, JSON-LD for SEO
- **Accounts:** email/password (plus optional Google), saved homes, saved searches, profile
- **Agent and broker dashboard:** manage listings, route and work leads, users and roles, MLS feed health
- **MLS/IDX:** RESO Web API sync (FMLS, Georgia MLS or any RESO vendor), with IDX attribution and disclaimers built in

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Postgres + Drizzle ORM,
Better Auth, MapLibre GL (OpenFreeMap tiles, no API key), Vitest and Playwright.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for how it fits together.

## Quick start

```bash
npm install                  # also copies the MapLibre worker into public/vendor
cp .env.example .env.local   # then set BETTER_AUTH_SECRET
docker compose up -d         # local Postgres (or point DATABASE_URL at Neon/Supabase)
npm run db:reset             # run migrations + seed fictional Metro Atlanta demo data
npm run dev                  # http://localhost:3000
```

Demo logins (password `adams-demo-2026`, override with `SEED_PASSWORD`):

| Role  | Email                        | Can…                                                 |
| ----- | ---------------------------- | ---------------------------------------------------- |
| admin | `admin@adamsrealty.example`  | everything: all listings, lead routing, roles, feeds |
| agent | `daniel@adamsrealty.example` | manage own listings and leads                        |
| buyer | `buyer@example.com`          | save homes and searches, request tours               |

## Scripts

| Command               | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Dev server                                            |
| `npm run build`       | Production build (needs no database at build time)    |
| `npm run lint`        | ESLint                                                |
| `npm run typecheck`   | TypeScript                                            |
| `npm test`            | Unit tests (Vitest)                                   |
| `npm run test:e2e`    | End-to-end tests (Playwright; seeded DB + dev server) |
| `npm run db:generate` | Create a migration from schema changes                |
| `npm run db:migrate`  | Apply migrations                                      |
| `npm run db:seed`     | Reset and seed demo data (refuses in production)      |
| `npm run mls:sync`    | Sync MLS feeds now (`-- --full`, `-- --purge`)        |

## Before launch: things only Adams Realty can provide

1. **Company details** in `src/config/site.ts` (marked `PLACEHOLDER`): phone, email,
   office address, and GREC firm license number. Georgia advertising rules require the
   firm name and phone number, and the footer shows both on every page.
2. **Your team.** Replace the sample agents: invite each agent to sign up, then in
   _Dashboard → Users & roles_ set their role to Agent and link their profile.
3. **Your MLS feed** (see below). Until then the site shows fictional demo listings.
4. **Photos.** The demo uses Unsplash images; real listings bring MLS photos.

## Connecting your MLS (IDX)

1. Sign an IDX agreement with your MLS (FMLS and/or Georgia MLS) and request RESO Web
   API access. Your MLS will point you to its vendor (e.g. Bridge, Trestle, Spark or MLS Grid).
2. Add a row to `data_sources`:
   ```sql
   insert into data_sources (slug, name, kind, config, disclaimer) values (
     'fmls', 'FMLS', 'reso_web_api',
     '{"baseUrl":"https://<vendor>/odata","resource":"Property","credentialsEnvPrefix":"MLS_FMLS",
       "filter":"StandardStatus ne ''Incomplete''","companyOfficeIds":["<your MLS office id>"]}',
     '<the exact IDX disclaimer text your MLS requires>'
   );
   ```
3. Set the credentials (`MLS_FMLS_TOKEN`, or `_CLIENT_ID`/`_CLIENT_SECRET` plus `config.tokenUrl`).
4. Run `npm run mls:sync -- --full` once. After that, Vercel Cron syncs every 15 minutes
   and purges off-market listings daily (`vercel.json`).
5. Set each agent's `mls_agent_id` so feed listings link to their profiles.

## Deploying

Vercel plus Neon (or Supabase) Postgres is the simplest setup:

1. Import the repo into Vercel and add the environment variables from `.env.example`.
2. Run `npm run db:migrate` against the production database (locally or in CI).
3. The crons in `vercel.json` run the MLS sync. Every-15-minute crons need a Vercel Pro plan.
