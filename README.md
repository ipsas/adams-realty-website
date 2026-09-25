# Adams Realty

The website for **Adams Realty, Inc.**, a real estate brokerage at 69 Mill Street in
Royston, Georgia, serving Northeast Georgia (Franklin, Hart, Madison, Stephens, Jackson,
Hall and Gwinnett counties): houses, land, lake property, hunting land, farms and
commercial property. Home search that's faster, cleaner and more honest than the big
portals: it has no ads, never sells leads, and every listing shows its true monthly cost.

- **Search:** URL-driven filters, full-text and map search, clustered price-pin map, saved searches with alerts
- **Listing pages:** photo gallery, full monthly-cost calculator, price history, schools, map, JSON-LD for SEO
- **Accounts:** email/password (plus optional Google), saved homes, saved searches, profile
- **Agent and broker dashboard:** manage listings, route and work leads, users and roles, MLS feed health
- **MLS/IDX:** RESO Web API sync (set up for Georgia MLS; works with any RESO vendor), with IDX attribution and disclaimers built in

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Postgres + Drizzle ORM,
Better Auth, MapLibre GL (OpenFreeMap tiles, no API key), Vitest and Playwright.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for how it fits together.

## Quick start

```bash
npm install                  # also copies the MapLibre worker into public/vendor
cp .env.example .env.local   # then set BETTER_AUTH_SECRET
docker compose up -d         # local Postgres (or point DATABASE_URL at Neon/Supabase)
npm run db:reset             # run migrations + seed demo data (fictional Northeast Georgia listings)
npm run dev                  # http://localhost:3000
```

Demo logins (password `adams-demo-2026`, override with `SEED_PASSWORD`):

| Role  | Email                        | Who                                  | Can…                                                 |
| ----- | ---------------------------- | ------------------------------------ | ---------------------------------------------------- |
| admin | `admin@adamsrealty.example`  | Andrea Anderegg (broker), demo login | everything: all listings, lead routing, roles, feeds |
| agent | `daniel@adamsrealty.example` | a fictional sample agent             | manage own listings and leads                        |
| buyer | `buyer@example.com`          | a fictional home shopper             | save homes and searches, request tours               |

**What's real in the demo data.** Andrea Anderegg's agent profile holds only facts from her
public profiles: name, title, phone, Georgia MLS agent ID and listed specialties. Everything else
in the seed (the other agents, every listing, lead and saved search) is fictional sample data
for demonstration only; the demo feed's disclaimer in the footer says so. The company details
in `src/config/site.ts` (firm name, office address and phone, Georgia MLS office ID) are real.

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

1. **Company details** in `src/config/site.ts` still marked `PLACEHOLDER`:
   - the company email (shown on every page, and where unassigned leads go unless
     `LEADS_INBOX` is set),
   - the GREC firm license number (hidden until set),
   - office hours (hidden until set).

   The firm name, office address (69 Mill Street, Royston) and phone ((706) 246-0053) are
   already real. Georgia advertising rules require the firm name and phone number, and the
   footer shows both on every page.

2. **Andrea's profile.** Her bio, headshot, email and years in the business are unknown, so
   the demo shows a short, neutral bio and her initials. Add them in _Dashboard → Agents_.
3. **Your team.** Remove the fictional sample agents. Invite each real agent to sign up,
   then in _Dashboard → Users & roles_ set their role to Agent and link their profile.
4. **Your MLS feed** (see below). Until then the site shows fictional demo listings.
   Launch on a fresh database without `SEED_DEMO_DATA`, so no demo data goes live.
5. **Photos.** The demo uses Unsplash images; real listings bring MLS photos.

## Connecting your MLS (IDX)

Adams Realty is a Georgia MLS member (office ID `ADAM01`), so the IDX feed comes from
Georgia MLS.

1. Sign Georgia MLS's IDX agreement and request RESO Web API access. Georgia MLS will give
   you the API endpoint and credentials (or point you to its data vendor).
2. Add a row to `data_sources`:
   ```sql
   insert into data_sources (slug, name, kind, config, disclaimer) values (
     'gamls', 'Georgia MLS', 'reso_web_api',
     '{"baseUrl":"https://<vendor>/odata","resource":"Property","credentialsEnvPrefix":"MLS_GAMLS",
       "filter":"StandardStatus ne ''Incomplete''","companyOfficeIds":["ADAM01"]}',
     '<the exact IDX disclaimer text Georgia MLS requires>'
   );
   ```
   `companyOfficeIds` marks listings from office `ADAM01` as Adams listings.
3. Set the credentials (`MLS_GAMLS_TOKEN`, or `_CLIENT_ID`/`_CLIENT_SECRET` plus `config.tokenUrl`).
4. Run `npm run mls:sync -- --full` once. After that, Vercel Cron syncs the feed and purges
   off-market listings on the schedule in `vercel.json` (daily; see _Deploying_).
5. Set each agent's MLS agent ID (_Dashboard → Agents_) so feed listings link to their
   profiles. Andrea Anderegg's is `ANDEREGGAA`.

## Deploying

Vercel plus Neon (or Supabase) Postgres is the simplest setup:

1. Import the repo into Vercel and add the environment variables from `.env.example`.
2. Deploys run `npm run vercel-build`, which applies migrations before building. For a
   preview with demo data, set `SEED_DEMO_DATA=1` and `SEED_PASSWORD`; it seeds only an
   empty database.
3. The crons in `vercel.json` run the MLS sync, the off-market purge and email alerts once a
   day, which is what Vercel's free (Hobby) plan allows. On Vercel Pro you can run them more
   often: set the sync to `*/15 * * * *` and alerts to `5 * * * *` (hourly), so "as soon as
   homes are listed" alerts go out within the hour.
4. Maps use OpenFreeMap (no API key): its positron style in light mode and its dark style in
   dark mode. To use another MapLibre style, set `NEXT_PUBLIC_MAP_STYLE_URL` (light) and
   optionally `NEXT_PUBLIC_MAP_STYLE_DARK_URL`; with only the light one set, dark mode uses it
   too. Update the privacy page if the provider changes.
