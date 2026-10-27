# Handoff: finishing the Adams Realty site locally

Status as of the end of the cloud session. Everything is on GitHub, on branch
**`claude/stoic-gates-vjolq3`** in `ipsas/adams-realty-website`.

## 1. Where things stand

| Area                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop site**         | ✅ Done. The branch includes: search with map; property pages; saved homes and searches; email alerts; accounts; broker/agent dashboard (listings, open houses, photos, leads with notes and CSV export, agent profiles, users and roles, MLS feed health); about, contact, privacy, terms, accessibility and fair-housing pages; neighborhood guides.                                                                                                                                                              |
| **Real company details** | ✅ Adams Realty, Inc., 69 Mill Street, Royston, GA 30662, (706) 246-0053, contracts.adamsrealty@gmail.com, Georgia MLS office `ADAM01`; office hours (Mon–Fri, 9 a.m.–5 p.m.), GREC firm license 6079 and DMCA designated agent (DMCA-1081724), provided on 2026-10-02.                                                                                                                                                                                                                                             |
| **The team**             | ✅ Adams Realty's five real agents. Andrea Anderegg (broker): headshot (`public/team/andrea-anderegg.webp`, chosen from the ones she sent), email, direct line (850) 572-3287, MLS agent ID `ANDEREGGAA` and her own bio. Emily Cooper, Avery McGarity, Erika Lane and Anitra Thompson: names and titles, plus Erika's and Anitra's bios (their MLS agent IDs are unconfirmed placeholders, `MLS_AGENT_IDS` in `scripts/seed-data.ts`); their headshots (provided 2026-10-05); they use the office phone and email. |
| **Sample market**        | ✅ Fictional listings across Georgia: Adams Realty's own in Northeast Georgia (Franklin, Hart, Madison, Stephens, Jackson, Hall and Gwinnett counties: homes, Lake Hartwell property, farms and land, and a **Commercial** type), credited to the five agents in turn, and other brokerages' statewide (Atlanta, Savannah, Athens, Macon and more). Every listing is fake (the agents are real), and the footer says so.                                                                                            |
| **Checks on the branch** | ✅ Lint, typecheck, 298 unit tests, 22 end-to-end tests and the production build all pass.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Mobile app (PWA)**     | 🟡 Designed and started, not finished. See section 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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
- `agent@adamsrealty.example` and `agent2@adamsrealty.example` are demo logins for Emily Cooper's
  and Avery McGarity's agent profiles (demo-only addresses: their direct emails aren't known, so
  their profiles show the office inbox).
- `buyer@example.com` is a fictional home shopper.

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
   The build seeds only an empty database. A test link set up before the team became real keeps
   the old seed's fictional agents until its database is reloaded by hand (README → "Deploying":
   `npx tsx scripts/seed.ts --force` with that database's connection string). Reloading wipes
   everything on it, test logins, leads and saved homes included, so only do it on a demo
   database nobody real has signed up to or sent an inquiry through.

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

- [ ] **Georgia MLS IDX feed.** Georgia MLS serves its IDX feed for office `ADAM01` through
      Bridge Interactive's RESO Web API (`src/lib/mls/gamls.ts`). When the token arrives, set
      `MLS_GAMLS_TOKEN` and follow README → "Connecting your MLS". Andrea's listings then
      appear automatically, credited to her. Confirm the other four agents' MLS agent IDs
      (unconfirmed placeholders in `MLS_AGENT_IDS`, `scripts/seed-data.ts`) with Adams Realty.
- [x] **GREC firm license number** and **office hours.** Done: license 6079 and Mon–Fri,
      9 a.m.–5 p.m., provided on 2026-10-02 (`src/config/site.ts`).
- [x] **Andrea's bio.** Done: the bio she provided (`scripts/seed-data.ts`).
- [x] **The team.** Done: the fictional sample agents are gone, replaced by the five real agents
      (`AGENTS` in `scripts/seed-data.ts`). Each profile holds only what Adams Realty provided.
- [x] **Agent photos.** Done: all five headshots, provided on 2026-10-05 (`public/team/`). Avery's
      photo was the only one of a man in that email (IMG_0167), so it was matched by elimination.
- [ ] **Bios still to come** for Emily Cooper and Avery McGarity (their profiles show none), and
      the four agents' direct phones/emails if they want them shown. Add them in
      Dashboard → Agents and `scripts/seed-data.ts`.
- [ ] **Legal review** of `/privacy` and `/terms` (they are drafts).
- [ ] **Email sending.** Create a [Resend](https://resend.com) account, verify your domain, and set
      `RESEND_API_KEY`, `EMAIL_FROM` and `LEADS_INBOX`. Until then no emails are sent (the
      server logs them instead). Once it's set, each new lead goes to its agent (or
      `LEADS_INBOX`) with a copy to Andrea, agents are emailed when she assigns them a lead,
      and every staff member gets a 7 a.m. summary of leads that need attention. Andrea can
      turn her copies and the summary off in _Dashboard → Email settings_.
- [ ] **Domain and hosting.** Add your domain in Vercel. The live business site should be on Vercel
      Pro, whose terms cover commercial use and which allows the 15-minute MLS sync. The
      project is on Pro, and `vercel.json` holds the Pro schedules: `/api/cron/sync` every 15
      minutes (`*/15 * * * *`); `/api/cron/sync?purge=1` as its own daily run at `38 9 * * *`
      (it only removes listings that left the feed; minute 38 is clear of the 9:30 sync, which
      ends within 5 minutes, and of the 9:45 one. If they ever meet, the purge waits for the
      sync, or fails visibly in _Dashboard → MLS feeds_); `/api/cron/alerts` hourly
      (`5 * * * *`). `src/app/api/cron/sync/schedule.test.ts` checks them. (Hobby rejects
      sub-daily crons.)
- [ ] **Statewide cutover order.** Deploy the migrations (including `drizzle/0009`, which pins
      saved searches with no location to Northeast Georgia so their alerts don't widen), run the
      first statewide load below, then widen the feed's filter to statewide. The "all of Georgia"
      copy should go live only once statewide listings are live, and only after Georgia MLS
      confirms the IDX license allows statewide display.
- [x] **Georgia MLS logo.** Done: the official GAMLS IDX logo is `public/brand/gamls_idx.png`,
      set in `site.mls.logo` (`src/config/site.ts`); feed cards, area tiles and map popups also
      carry it at 20 px with "© <year> Georgia MLS". The IDX disclaimer is still a placeholder
      (`site.mls.disclaimer`).
- [x] **The firm's own Coming Soon, Withdrawn, Expired and Canceled listings.** Decided: hidden
      from the public like Georgia MLS ones (`drizzle/0011`). Agents still see and edit them in
      the dashboard; they appear on the site once their status is Active (or under contract,
      pending or sold).
- [ ] **Corrections contact for Georgia MLS.** `/listing-corrections` publishes
      (706) 246-0053 and contracts.adamsrealty@gmail.com (`site.mls.corrections`). The IDX
      agreement asks for a _dedicated_ email: create one (e.g. listings@ your domain) if you
      prefer, and give Georgia MLS the page's address. Fix or remove a reported listing within
      one business day.
- [x] **DMCA agent** (IDX agreement §11). Done: Andrea A. Anderegg is Adams Realty, Inc.'s
      designated agent, U.S. Copyright Office registration **DMCA-1081724** (effective
      2026-10-02). `site.dmca` holds the details; `/terms#copyright` publishes them with what a
      notice must include, linked from the footer ("Copyright (DMCA)").
- [ ] **Check the feed's field names.** When feed access arrives, confirm the attribution
      contact phone/email, Variable Compensation and compensation fields match
      `attribution()` and `compensation()` in `src/lib/mls/reso/mapper.ts`, and that the feed
      sends `OriginalEntryTimestamp` (the list date).
- [ ] **First statewide MLS load.** Run `npm run mls:sync -- --full` from a computer against the
      production database (20–60 minutes; it can't run on Vercel), before the cron takes over.
      See README → "Connecting your MLS".
- [ ] **Production database without demo data.** Use a fresh database with `SEED_DEMO_DATA` unset,
      run migrations, and create Andrea's real login by signing up; an admin can then set roles.
      Add the five agent profiles in Dashboard → Agents, from `AGENTS` in `scripts/seed-data.ts`.
- [ ] **Until launch: keep the site behind the preview password.** Set `PREVIEW_PASSWORD` in
      Vercel (Production, and Preview if you use it) and redeploy, then give the password to
      Andrea and the testers. Everyone else sees only the coming-soon page (`/preview`) with
      the office's phone, email, address, hours and license. To change the password, edit it
      and redeploy: every browser has to enter the new one. See README → "The preview
      password".
- [ ] **Launch day: open the site, switch off demo-data mode, then invite Google and Bing.**
      While the site shows sample listings, it tells search engines to stay away from search,
      listing, area, places and agent pages (`noindex`, `robots.txt` and the sitemaps;
      `src/lib/demo-mode.ts`), and the preview password keeps the public out altogether.
      Demo-data mode is on wherever `SEED_DEMO_DATA=1`. Once the real MLS listings are live,
      do both together in Vercel: **remove `PREVIEW_PASSWORD`** and **set
      `DEMO_DATA_MODE=off`** (or remove `SEED_DEMO_DATA`), then redeploy. Check, in a private
      window, that `/` opens the home page instead of the coming-soon page, that `/robots.txt` lists the
      `/homes/sitemap/…` chunks again (not `Disallow: /`) and that a listing page no longer
      sends `X-Robots-Tag: noindex`. Then submit `/robots.txt`'s sitemaps in
      [Google Search Console](https://search.google.com/search-console) and
      [Bing Webmaster Tools](https://www.bing.com/webmasters) (check whether Search Console is
      already set up for the domain). If any sample page was indexed before this mode existed,
      use Search Console's Removals tool for it.
- [ ] **After launch (optional): run the proxy on fewer requests again.** To gate every page,
      `src/proxy.ts` runs on every request, also with the gate off: each page view, link
      prefetch and form post is one more proxy call on Vercel (a little latency and cost).
      Once you're sure the preview password won't be needed again, remove the gate
      (`src/lib/preview-gate.ts` and its tests, `src/app/preview/`, the gate step in
      `src/proxy.ts`) and put back the narrow `config.matcher` listed in ARCHITECTURE.md →
      "Preview gate", updating the matcher test. Do both or neither: with the narrow matcher
      a later `PREVIEW_PASSWORD` would cover only some pages.
- [ ] **The office's internet address.** So the office never meets the listing rate limit, set
      `OFFICE_IPS` in Vercel to the office's public IP address (several can be separated by commas;
      ranges like `203.0.113.0/28` work; if the office has IPv6, add its block, such as
      `2001:db8:1:2::/64`, since its devices change their IPv6 address often). Empty by default. Staff who are signed in are never
      limited anyway.
- [ ] **Postal address in emails.** It's already set from the office address; confirm it's correct.
- [ ] **Photo resizing (may carry a small monthly cost).** Georgia MLS photos arrive full size
      (often 1–3 MB each), so the site sends them through Vercel's image optimization, which
      makes phone-sized copies (at most 800 px wide on phones) and keeps each copy for a week
      (`src/lib/photos.ts`, `next.config.ts`). Vercel counts every new copy (one photo at one
      width) as a transformation: plans include an allowance and Pro bills beyond it, so check
      [Vercel's pricing](https://vercel.com/pricing) and the Usage tab after the first week of
      real listings. Most photos are seen at two or three widths. If the cost ever matters,
      the allowed hosts in `next.config.ts` (`images.remotePatterns`, today any host, because
      agents paste photo links from anywhere) can be narrowed to the MLS photo host. When the
      feed is connected, open a few real listings in Chrome with DevTools' phone view and its
      Network tab, and check that their photos load from `/_next/image` at 800 px or less,
      never straight from the MLS host.

## 7. Where to look in the code

- `ARCHITECTURE.md`: how everything fits together (data flow, MLS sync, search, permissions).
- `CLAUDE.md`: conventions and gotchas for anyone, human or Claude, working in the repo.
- `src/config/site.ts`: company, market and brand settings.
- `src/lib/auth/permissions.ts`: who can do what (fully unit-tested).
