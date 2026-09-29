# Handoff: finishing the Adams Realty site locally

Status as of the end of the cloud session. Everything is on GitHub, on branch
**`claude/stoic-gates-vjolq3`** in `ipsas/adams-realty-website`.

## 1. Where things stand

| Area                     | Status                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop site**         | ✅ Done. The branch includes: search with map; property pages; saved homes and searches; email alerts; accounts; broker/agent dashboard (listings, open houses, photos, leads with notes and CSV export, agent profiles, users and roles, MLS feed health); about, contact, privacy, terms, accessibility and fair-housing pages; neighborhood guides.                                        |
| **Real company details** | ✅ Adams Realty, Inc., 69 Mill Street, Royston, GA 30662, (706) 246-0053, contracts.adamsrealty@gmail.com, Georgia MLS office `ADAM01`.                                                                                                                                                                                                                                                       |
| **Andrea Anderegg**      | ✅ Broker profile with her headshot (`public/team/andrea-anderegg.webp`), email, direct line (850) 572-3287, and MLS agent ID `ANDEREGGAA`. Her bio is a neutral placeholder until she provides one.                                                                                                                                                                                          |
| **Sample market**        | ✅ Fictional listings across Georgia: Adams Realty's own in Northeast Georgia (Franklin, Hart, Madison, Stephens, Jackson, Hall and Gwinnett counties: homes, Lake Hartwell property, farms and land, and a **Commercial** type), other brokerages' statewide (Atlanta, Savannah, Athens, Macon and more). Every listing, and every agent other than Andrea, is fake, and the footer says so. |
| **Checks on the branch** | ✅ Lint, typecheck, 298 unit tests, 22 end-to-end tests and the production build all pass.                                                                                                                                                                                                                                                                                                    |
| **Mobile app (PWA)**     | 🟡 Designed and started, not finished. See section 4.                                                                                                                                                                                                                                                                                                                                         |

## 2. Run it on your computer

You need [Node.js 22+](https://nodejs.org), [Git](https://git-scm.com), and either
[Docker Desktop](https://www.docker.com/products/docker-desktop/) or a Postgres database
(a free [Neon](https://neon.tech) database works too).

```bash
git clone https://github.com/ipsas/adams-realty-website.git
cd adams-realty-website
git checkout claude/stoic-gates-vjolq3
npm install
cp .env.example .env.local        # open it and set BETTER_AUTH_SECRET to any 32+ random characters
docker compose up -d              # local Postgres (skip if you set DATABASE_URL to Neon)
npm run db:reset                  # creates tables + loads the sample listings (statewide; Adams's own in Northeast Georgia)
npm run dev                       # open http://localhost:3000
```

Logins (password `adams-demo-2026`):

- `admin@adamsrealty.example` is Andrea's broker login, with the full dashboard.
- `daniel@adamsrealty.example` is a sample agent.
- `buyer@example.com` is a home shopper.

Real photos and the map load on your machine. They were blank in the cloud screenshots only
because that sandbox blocked those servers.

## 3. Share a test link (Vercel, free)

1. At [vercel.com](https://vercel.com), sign up with GitHub. Choose **Add New → Project**, import
   `ipsas/adams-realty-website`, and use branch `claude/stoic-gates-vjolq3`.
2. Add **Environment Variables**:
   - `BETTER_AUTH_SECRET`: 32+ random characters
   - `SEED_DEMO_DATA`: `1`
   - `SEED_PASSWORD`: a password for the test logins
3. Deploy. Then **Storage → Create Database → Neon** and connect it to the project.
4. **Redeploy.** The build creates the tables and loads the sample data (`scripts/vercel-build.mjs`).

Every later push gets its own preview link automatically.

## 4. Finish the mobile app

The full mobile design is in **`docs/mobile-spec/`**:

- `features.md`: what each mobile feature does and why it beats the Zillow and Homes.com apps
- `foundation.md`: shared building blocks (already built; see below)
- `workpackages.md`: six work packages (WP1–WP6) with file lists, steps and acceptance tests

### Step 1: apply the mobile foundation (already built)

`handoff/mobile-foundation.patch` holds the foundation, 45 files:

- mobile-friendly sheets and dialogs (close on Back, swipe down, keyboard-aware)
- toasts with Undo
- safe-area and notch handling, and 16px inputs so iOS doesn't zoom
- 44px tap targets and accessible contrast colors
- the all-in monthly cost helper
- recent searches and recently viewed homes
- tap-to-call, text and directions links
- service-worker helpers
- a phone-emulation test harness with accessibility checks
- a dev test page at `/dev/primitives`

On its own base it typechecked and passed 187 unit tests. Its end-to-end "exit criteria" were
not fully verified.

```bash
git checkout -b mobile claude/stoic-gates-vjolq3
git apply --3way handoff/mobile-foundation.patch
# One expected conflict: src/lib/search/params.test.ts. Keep BOTH sides: the commercial
# property-type tests and the new sort-label tests.
npm install                       # adds @axe-core/playwright
npx playwright install chromium
npm run lint && npm run typecheck && npm test
npm run test:e2e                  # includes the new phone projects (pixel7, iphone13, …)
git add -A && git commit -m "Mobile foundation"
```

### Step 2: build the six work packages

Do them one at a time, in this order: **WP2 → WP3 → WP4 → WP5 → WP1 → WP6**.

| WP  | What it adds                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| WP2 | App shell: bottom tab bar, mobile header and menu, saving that survives sign-in, home and auth pages on phones        |
| WP3 | Search map with a 3-position results sheet, pin preview strip, Back restores your place, all-in monthly cost on cards |
| WP4 | Compact search bar, full-screen search, filter sheet with a live "Show N homes" count, Near me                        |
| WP5 | Mobile listing page: full-screen photo viewer (pinch and swipe), sticky Save/Contact/Tour bar, tour sheet, directions |
| WP1 | Installable app: manifest and icons, offline saved homes, install prompt, redesigned saved homes with notes           |
| WP6 | Staff on phones: lead cards with one-tap call/text, dashboard shell                                                   |

## 5. Continue with Claude Code on your computer

Install [Claude Code](https://docs.claude.com/en/docs/claude-code), open a terminal in the repo,
and run `claude`. It reads `CLAUDE.md` automatically. Suggested prompts, one per session:

1. _"Read HANDOFF.md. Apply handoff/mobile-foundation.patch as described in section 4, step 1,
   resolve the conflict, get lint/typecheck/unit/e2e green, and commit."_
2. _"Read docs/mobile-spec/ and implement WP2 exactly as specified in workpackages.md, on top of
   the foundation. Run its acceptance tests on the pixel7 and iphone13 projects, then commit."_
   Repeat for WP3, WP4, WP5, WP1 and WP6.
3. _"Fact-check every description in src/config/areas.ts against reliable sources. Remove anything
   you can't verify, and never add school, crime or demographic claims."_ The automated fact-check
   didn't get to run before the cloud session ended.

Use your model table: Opus High for the work packages, and Xhigh if one gets stuck.

## 6. Before launch: things only Adams Realty can provide or decide

- [ ] **Georgia MLS IDX feed.** Ask Georgia MLS for an IDX data feed (RESO Web API) for office
      `ADAM01`, then follow README → "Connecting your MLS". Andrea's listings then appear
      automatically, credited to her.
- [ ] **GREC firm license number** and **office hours**. Set them in `src/config/site.ts`.
- [ ] **Andrea's bio** (a few sentences). Edit it in Dashboard → My profile, or in `scripts/seed-data.ts`.
- [ ] **Other agents.** Remove the sample agents, or send real names, photos and bios.
- [ ] **Legal review** of `/privacy` and `/terms` (they are drafts).
- [ ] **Email sending.** Create a [Resend](https://resend.com) account, verify your domain, and set
      `RESEND_API_KEY`, `EMAIL_FROM` and `LEADS_INBOX`. Until then no emails are sent.
- [ ] **Domain and hosting.** Add your domain in Vercel. The live business site should be on Vercel
      Pro, whose terms cover commercial use and which allows the 15-minute MLS sync. Only
      after the project is on Pro (a sub-daily cron fails every deployment on Hobby, which the
      preview link uses), change the `crons` in `vercel.json`: `/api/cron/sync` to
      `*/15 * * * *` (every 15 minutes); keep `/api/cron/sync?purge=1` as its own daily run at
      `38 9 * * *` (it only removes listings that left the feed; minute 38 is clear of the
      9:30 sync, which ends within 5 minutes, and of the 9:45 one. If they ever meet, the
      purge waits for the sync, or fails visibly in _Dashboard → MLS feeds_); `/api/cron/alerts` to
      `5 * * * *` (hourly), and update `src/app/api/cron/sync/schedule.test.ts`, which holds
      `vercel.json` to Hobby's rules. Until then the schedules stay daily, with the purge at
      `0 11 * * *`, two hours after the 9:00 sync: Hobby may fire a daily cron at any minute of
      its hour, so a purge in the next hour could still meet a sync that started at 9:59. If
      a daily sync ends "partial" in _Dashboard → MLS feeds_, run `npm run mls:sync` from a
      computer to catch up.
- [ ] **Statewide cutover order.** Deploy the migrations (including `drizzle/0009`, which pins
      saved searches with no location to Northeast Georgia so their alerts don't widen), run the
      first statewide load below, then widen the feed's filter to statewide. The "all of Georgia"
      copy should go live only once statewide listings are live, and only after Georgia MLS
      confirms the IDX license allows statewide display.
- [x] **Georgia MLS logo.** Done: the official files from gamls.com/logos are in
      `public/brand/` and set in `site.mls.logo` (`src/config/site.ts`).
- [x] **The firm's own Coming Soon, Withdrawn, Expired and Canceled listings.** Decided: hidden
      from the public like Georgia MLS ones (`drizzle/0011`). Agents still see and edit them in
      the dashboard; they appear on the site once their status is Active (or under contract,
      pending or sold).
- [ ] **Corrections contact for Georgia MLS.** `/listing-corrections` publishes
      (706) 246-0053 and contracts.adamsrealty@gmail.com (`site.mls.corrections`). The IDX
      agreement asks for a _dedicated_ email: create one (e.g. listings@ your domain) if you
      prefer, and give Georgia MLS the page's address. Fix or remove a reported listing within
      one business day.
- [ ] **DMCA agent.** Register Adams Realty, Inc.'s DMCA agent at copyright.gov/dmca-directory
      (IDX agreement §11).
- [ ] **Check the feed's field names.** When feed access arrives, confirm the attribution
      contact phone/email, Variable Compensation and compensation fields match
      `attribution()` and `compensation()` in `src/lib/mls/reso/mapper.ts`, and that the feed
      sends `OriginalEntryTimestamp` (the list date).
- [ ] **First statewide MLS load.** Run `npm run mls:sync -- --full` from a computer against the
      production database (20–60 minutes; it can't run on Vercel), before the cron takes over.
      See README → "Connecting your MLS".
- [ ] **Production database without demo data.** Use a fresh database with `SEED_DEMO_DATA` unset,
      run migrations, and create Andrea's real login by signing up; an admin can then set roles.
- [ ] **Postal address in emails.** It's already set from the office address; confirm it's correct.

## 7. Where to look in the code

- `ARCHITECTURE.md`: how everything fits together (data flow, MLS sync, search, permissions).
- `CLAUDE.md`: conventions and gotchas for anyone, human or Claude, working in the repo.
- `src/config/site.ts`: company, market and brand settings.
- `src/lib/auth/permissions.ts`: who can do what (fully unit-tested).
