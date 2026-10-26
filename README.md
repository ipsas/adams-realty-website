# Adams Realty

The website for **Adams Realty, Inc.**, a real estate brokerage at 69 Mill Street in
Royston, Georgia, serving Northeast Georgia (Franklin, Hart, Madison, Stephens, Jackson,
Hall and Gwinnett counties): houses, land, lake property, hunting land, farms and
commercial property. Its search covers listings across all of Georgia from Georgia MLS;
outside Northeast Georgia a listing takes questions for the office instead of tour requests. Home search that's faster, cleaner and more honest than the big
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
npm run db:reset             # run migrations + seed demo data (fictional listings across Georgia)
npm run dev                  # http://localhost:3000
```

Demo logins (password `adams-demo-2026`, override with `SEED_PASSWORD`):

| Role  | Email                        | Who                                  | Can…                                                 |
| ----- | ---------------------------- | ------------------------------------ | ---------------------------------------------------- |
| admin | `admin@adamsrealty.example`  | Andrea Anderegg (broker), demo login | everything: all listings, lead routing, roles, feeds |
| agent | `agent@adamsrealty.example`  | Emily Cooper (agent), demo login     | manage own listings and leads                        |
| agent | `agent2@adamsrealty.example` | Avery McGarity (agent), demo login   | manage own listings and leads                        |
| buyer | `buyer@example.com`          | a fictional home shopper             | save homes and searches, request tours               |

**What's real in the demo data.** The team: Adams Realty, Inc.'s five agents (Andrea Anderegg,
broker; Emily Cooper; Avery McGarity; Erika Lane; Anitra Thompson) are real people, and their
profiles hold only what Adams Realty provided (for Andrea, also facts from her public profiles).
Where an agent's direct phone or email isn't known, the office's is shown; a missing bio, photo,
area or language is left out, never filled in. The demo login addresses are demo-only. Everything
else in the seed (every listing, including the ones credited to our agents, and every lead and
saved search) is fictional sample data for demonstration only; the demo feed's disclaimer in the
footer says so. The company details in `src/config/site.ts` (firm name, office address, phone and
email, office hours, GREC firm license, Georgia MLS office ID and DMCA designated agent) are real.

## Scripts

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Dev server                                            |
| `npm run build`         | Production build (needs no database at build time)    |
| `npm run lint`          | ESLint                                                |
| `npm run typecheck`     | TypeScript                                            |
| `npm test`              | Unit and database tests (Vitest; needs Postgres)      |
| `npm run test:e2e`      | End-to-end tests (Playwright; seeded DB + dev server) |
| `npm run db:generate`   | Create a migration from schema changes                |
| `npm run db:migrate`    | Apply migrations                                      |
| `npm run db:seed`       | Reset and seed demo data (refuses in production)      |
| `npm run mls:sync`      | Sync MLS feeds now (see _Connecting your MLS_)        |
| `npm run mls:add-gamls` | Add or activate the Georgia MLS (Bridge) feed         |

`npm run test:e2e` also starts a fake MLS photo host on 127.0.0.1:4010
(`e2e/fixtures/photo-host.mjs`, full-size 2.5 MB photos) for the photo tests. To measure
photo weight on a phone with a slow signal, start it, run a production build with
`E2E_PHOTO_HOST=http://127.0.0.1:4010 npx next start -p 3100`, then
`npx tsx scripts/perf/photo-weight.ts --base http://localhost:3100` (it moves some
listings' photos to the fake host in your local database and puts them back).

## Before launch: things only Adams Realty can provide

1. **Company details** in `src/config/site.ts`: done. The firm name, office address
   (69 Mill Street, Royston), phone ((706) 246-0053) and email are real, and Adams Realty
   provided the office hours, the GREC firm license number (6079) and the DMCA designated
   agent (registration DMCA-1081724, published at `/terms#copyright`) on 2026-10-02. Georgia
   advertising rules require the firm name and phone number, and the footer shows both on
   every page.

2. **The rest of the team's profiles.** All five headshots are in (`public/team/`, provided by
   Adams Realty on 2026-10-05). Emily Cooper and Avery McGarity have no bio yet.
   The four agents' direct phones and emails aren't known, so their profiles show the
   office's. No profile sets a years-in-real-estate figure (Erika's and Anitra's bios say when
   they started; the site doesn't turn that into a number), so that tile stays off. Add what
   arrives in _Dashboard → Agents_ (and in `scripts/seed-data.ts` for the demo).
3. **Agent logins.** The demo's agent logins are demo-only. In production, invite each agent
   to sign up, then in _Dashboard → Users & roles_ set their role to Agent and link their
   profile.
4. **Your MLS feed** (see below). Until then the site shows fictional demo listings.
   Launch on a fresh database without `SEED_DEMO_DATA`, so no demo data goes live. While
   `SEED_DEMO_DATA=1`, demo-data mode keeps search engines off the sample listings and the
   guides, places and agent pages that show them; `DEMO_DATA_MODE=off` switches it off
   (HANDOFF.md, launch checklist).
5. **Photos.** The demo uses Unsplash images; real listings bring MLS photos.

## The preview password (until launch)

Until the real Georgia MLS listings are connected, the live site stays private behind one
shared password, so the public never sees the sample listings:

- **Set `PREVIEW_PASSWORD`** in Vercel (_Project → Settings → Environment Variables_, for
  Production and, if you use them, Preview deployments) and redeploy. Environment changes
  only reach new deployments.
- **Visitors without it** see only the coming-soon page, `/preview`: the firm's name, phone,
  email, address, office hours and GREC license, and a small "Have a preview password?" form.
  Any other page sends them there (and back where they were going once they unlock), and so
  do the links in account emails (password reset, email verification); form posts, the API,
  sign-in and sitemaps answer 401. `robots.txt` says `Disallow: /`, and every response
  carries `noindex` and `Cache-Control: private, no-store`.
- **Andrea and testers** enter the password on `/preview`. That browser stays unlocked for 60
  days (an `adams_preview` cookie holding a signature of the password, never the password
  itself), and opening `/preview` again goes straight to the site. Sign-in and the dashboard
  work as usual behind it. Each address gets 10 tries per 15 minutes.
- **To change the password**, edit `PREVIEW_PASSWORD` in Vercel and redeploy. Every unlocked
  browser is locked out at once and needs the new one. (Rotating `BETTER_AUTH_SECRET` does
  that too, and also signs everyone out of their accounts.)
- **Still running behind it:** the Vercel Cron jobs (`/api/cron/*`, which check `CRON_SECRET`
  themselves), so saved-search and saved-home alert emails keep going out, and their
  unsubscribe links (`/alerts/one-click`, the mail app's button, and `/alerts/unsubscribe`,
  the link in the email), which check their own signed token and work for anyone. The
  unsubscribe page then shows only the firm's name, phone and license around it, without
  the site's menus and footer.
- **Launch day:** remove `PREVIEW_PASSWORD` and set `DEMO_DATA_MODE=off` together, then
  redeploy (HANDOFF.md, launch checklist). Unset or empty, the gate is off and the site
  behaves exactly as without it, which is also how the tests and local development run.
  To try it locally, put `PREVIEW_PASSWORD=…` in `.env.local` and restart `npm run dev`.

The gate is `src/lib/preview-gate.ts`, run first by `src/proxy.ts`; the coming-soon page is
`src/app/preview/`.

## Connecting your MLS (IDX)

Adams Realty is a Georgia MLS member (office ID `ADAM01`). Georgia MLS's IDX feed is served
by Bridge Interactive's RESO Web API; the source definition is `src/lib/mls/gamls.ts` (base
URL `https://api.bridgedataoutput.com/api/v2/OData/<dataset>`, `companyOfficeIds: ["ADAM01"]`
marks the firm's own listings).

1. **Placeholders to confirm before launch:**
   - the Bridge dataset name: set by `MLS_GAMLS_DATASET` (no default; the feed has no base URL
     until it is set);
   - the exact IDX disclaimer: `site.mls.disclaimer` in `src/config/site.ts`, copied into
     `data_sources.disclaimer` by the seed and by `npm run mls:add-gamls`;
   - the agents' Georgia MLS agent IDs: `MLS_AGENT_IDS` in `scripts/seed-data.ts`. Andrea's
     (`ANDEREGGAA`) is confirmed; the other four (Emily Cooper, Avery McGarity, Erika Lane,
     Anitra Thompson) are unconfirmed placeholders to verify with Adams Realty. Feed listings
     link to a profile only through this ID, so a wrong one means that agent's listings show
     without a profile link. Fix them there and, on a live database, in _Dashboard → Agents_.
2. **When the token arrives:** add `MLS_GAMLS_TOKEN` to Vercel (Production) and `.env.local`.
   Probe the feed with `curl` and the bearer token (`$top=1` on `Property`;
   `$select=ListingKey&$top=1000` to confirm the `$top` cap; no `$expand`: Bridge rejects it and
   returns `Media` inline) and add
   any new `StandardStatus`/`PropertyType` spelling to the mapper with a test. Then run
   `npm run mls:add-gamls` (upserts the `gamls` row and activates it once the token is set).
   Until then the site runs on demo data: the `gamls` row stays inactive (if activated without
   a token, the cron answers 200 and marks it "skipped"), and _Dashboard → MLS feeds_ shows
   which variable is missing.
3. **Run the first load from the command line, not on Vercel:** `npm run mls:sync -- --full`
   on your computer (or a CI job) with `DATABASE_URL` pointing at the production database. A
   statewide feed is about 65,000 listings and takes 20–60 minutes, far longer than a Vercel
   function may run (300 seconds). It's safe to stop and rerun: every page of 200 listings is
   saved with the feed position, and a plain `npm run mls:sync` carries on from there. Then
   run `npm run mls:sync -- --purge` and check _Dashboard → MLS feeds_.

   After that, Vercel Cron syncs the feed every 15 minutes and purges off-market listings
   daily (`vercel.json`; see _Deploying_). Each cron run stops itself before the time limit
   and, if the feed had more changes than fit, ends as "partial" in _Dashboard → MLS feeds_;
   the next run continues from the same place.

   Other commands:
   - `npm run mls:sync`: an incremental sync (changes since the last one, re-reading the
     half hour before it in case the feed published something late). Records that haven't
     changed are skipped.
   - `npm run mls:sync -- --full`: the whole feed, every record rewritten. Besides the first
     load, this is how stored listings get repaired after a mapping fix or a new column.
   - `npm run mls:sync -- --purge`: only the purge: listings that left the feed are taken
     off the site. It compares the feed's live listings and the last year's sales (what the
     site shows), and it refuses to remove more than 5% of them at once, which usually
     means a feed problem rather than a real exodus. If you've checked that the feed really
     dropped them, add `--allow-large-purge` (the dashboard shows a warning when this happens).
     A purge that finds a sync still running waits for it; if it still can't start, it is
     recorded as failed (never skipped quietly), and the dashboard warns when no purge has
     finished for a day and a half.
   - `-- --minutes 4`: stop between pages after about 4 minutes.

4. Check each agent's Georgia MLS agent ID in _Dashboard → Agents_ (see the placeholders
   above) so feed listings link to their profiles.

## Deploying

Vercel plus Neon (or Supabase) Postgres is the simplest setup:

1. Import the repo into Vercel and add the environment variables from `.env.example`.
2. Deploys run `npm run vercel-build`, which applies migrations before building. For a
   preview with demo data, set `SEED_DEMO_DATA=1` and `SEED_PASSWORD`; it seeds only an
   empty database, and search engines are told to stay off the sample pages. A demo database
   seeded before the team became real keeps the old fictional sample agents until you reload
   it yourself: run `npx tsx scripts/seed.ts --force` with that database's `DATABASE_URL` and
   the same `SEED_PASSWORD`. That wipes everything on it, including its logins, leads and
   saved homes, so never point it at a database with real sign-ups or inquiries.
   **Preview deployments need their own `DATABASE_URL`** (a Neon branch or a dedicated
   preview database): `vercel-build` runs migrations in every environment and, with
   `SEED_DEMO_DATA=1`, seeds an empty database. Scope the production `DATABASE_URL` to
   Production only; never point Preview at the production database.
3. The crons in `vercel.json` are set for Vercel Pro, which the project is on: the MLS sync
   every 15 minutes (`*/15 * * * *`), the off-market purge (`?purge=1`, a separate
   purge-only run) daily at 09:38 UTC, a minute no sync can still be running in, and email
   alerts hourly (`5 * * * *`). (Hobby rejects sub-daily crons.) Vercel Cron fires only on
   Production deployments. The staff's 7 a.m. lead summary has no cron of its own: the sync
   and alerts routes both try it, and the first run at or after 7 a.m. Eastern sends it (by
   about 7:15), once a day.
4. Cached listing data (home page numbers and featured homes, area guide stats) refreshes
   right after each cron sync, and within 15 minutes after a sync run from the command line.
5. Maps use OpenFreeMap (no API key): its positron style in light mode and its dark style in
   dark mode. To use another MapLibre style, set `NEXT_PUBLIC_MAP_STYLE_URL` (light) and
   optionally `NEXT_PUBLIC_MAP_STYLE_DARK_URL`; with only the light one set, dark mode uses it
   too. Update the privacy page if the provider changes.
