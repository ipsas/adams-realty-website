# Dark mode (DM) and all of Georgia (GA): implementation plan

## Owner decisions (2026-09-25). These override the plan below.

- **Out-of-area listings:** outside the firm's Northeast Georgia area, a listing offers "Ask a question" instead of tour requests. The page says that Adams Realty works mainly in Northeast Georgia, and inquiries go to the office. Listings inside the firm's area keep "Request a tour".
- **Hosting costs are approved:** a paid Postgres plan, plus Vercel Pro with 15-minute syncs. Until the owner actually upgrades to Pro, **keep vercel.json's daily schedules**. A sub-daily cron fails deployment on Vercel Hobby, which the first client-preview link uses. Put the switch to `*/15 * * * *` (sync) with a separate daily purge in the go-live checklist (HANDOFF.md section 6), not in vercel.json.
- **Hero label:** "All of Georgia".
- **No fixed short list of towns.** The owner rejected "Popular: 5 towns" (their words: "dont limit to 5 towns like that"). Replace the hard-coded `featuredAreas` chips with a data-driven set: the cities with the most active listings, computed from the database and cached with the other home-page stats. Show more than five (e.g. up to 12, scrolling horizontally on phones), plus a "See all towns" link to a statewide places index. That index lists every city with active listings, grouped by county, each linking to its search. Nothing hard-codes Royston or any other town list. The footer town links follow the same rule.
- **Ads and selling leads come later**, "when we have solid user count". The copy now says "No ads." instead of "No ads. Ever.". Keep the no-ads and never-sell sentences as they are now.
- **Georgia MLS:** the owner will confirm with Georgia MLS that the IDX license allows statewide display, including sold listings, before the live site says "across Georgia" with real data. The demo site, which uses sample data, can say it now.

## Corrections from review. Where these conflict with the plan text, they win.

Verdict: The plan is thorough, but it has several gaps. Four are serious enough to fix before implementation starts:

- **Lake searches break on the real feed.** Moving the location `q` onto `location_vector` drops description matching. The RESO neighborhood field holds the subdivision name, so Lake Hartwell and Lake Lanier searches, including a featured chip, find almost nothing. The seed puts the lake in `neighborhood`, which hides this.
- **Out-of-area listings still promise tours.** Savannah and Valdosta listings keep in-person tour requests from a Royston firm.
- **Printing is unreadable in dark mode**, and 'Match my device' is the default, so every user with a dark OS is affected. No print styles exist.
- **The MLS sync has no time budget** inside the 300-second limit. The purge cap has no override, and a purge run still does a full incremental first.

Other problems:

- **Namespace collision:** gradient stops in Tailwind 4.3.3 read `--background-color-*`, so the brand-700/800 override repaints the brand gradients and photo frames the plan says stay fixed.
- **Build errors:** `theme.ts` pulls `local-store.ts`, which imports React hooks, into the server layout. The sitemap and robots chunking would also need a database at build time.
- **Performance gaps:** there is no index or target for `price_desc`, rent, sold or pending, and the harness has no closed-sale volume.
- **Tests that fail or can't fail:** `coverage.test` fails on existing lake rows, the theme guard contradicts the kept `hover:bg-ink/5`, and the light-screenshot regression isn't automated.
- **Firm-truth leaks:** the featured block ('Handpicked by our agents'), old saved searches silently widening to statewide, and payment defaults tuned for Northeast Georgia.
- **Hand-offs:** WP6 is missing, `location-map.tsx` is assigned to WP3 instead of WP5, and the switch uses `md:` rather than the `phone:`/`wide:` variants.

All findings come from reading files under C:\Dev\adams-realty-website, with nothing modified. Main files: src\app\globals.css, src\components\search\search-map.tsx, src\lib\search\query.ts, src\lib\mls\sync.ts, src\app\homes\[slug]\page.tsx, src\lib\listings\queries.ts, scripts\seed-sites.json and node_modules\tailwindcss\dist\lib.js.

1. **[high]** GA-C1 moves the location `q` from `search_vector` to a new `location_vector` built from address, city, ZIP, neighborhood and MLS number. That breaks lake searches on the real feed. The RESO mapper (C:\Dev\adams-realty-website\src\lib\mls\reso\mapper.ts:354) fills `neighborhood` from SubdivisionName, so on real data a lake name appears only in the description, which is exactly what `search_vector` matched. After the change, `/homes?q=Lake Hartwell` (a featured chip in the plan, and the firm's core product) and Lake Lanier return almost nothing. The seed assertion and e2e can't catch this: scripts\seed.ts:497 writes the lake name into `neighborhood`, which the real feed never does.
   - **Fix:** Before narrowing `q`, resolve lake names the way the area guides do. Either map RESO `WaterBodyName` into a new `water_body` column that goes into `location_vector`, or, when `q` matches an area guide or alias (`findArea`), use `areaCondition` plus the guide's geography. Add a query test with a fixture where the neighborhood is a subdivision and the lake appears only in WaterBodyName or the description, and require `q=Lake Hartwell` to return it.
2. **[high]** Out-of-area listings still promise in-person tours by Adams agents. GA-A3 rewrites only the no-agent heading and body. Every Savannah or Valdosta listing still gets `<ContactForm allowTour={!sold}>` with in-person tour as the default, the mobile CTA 'Request a tour' (homes\[slug]\page.tsx:534), the reply 'An Adams agent will confirm your tour shortly' (inquiries.ts:178), and the contact page's 'Someone who knows the area'. For a Royston firm these are false firm statements, and WP5, which fixes the tour sheet, lands much later.
   - **Fix:** In GA-A, pass `allowTour={!sold && isFirmArea(l)}` (or a question-first mode) and switch the mobile CTA label to 'Ask about this home' outside the firm's area. Give out-of-area inquiries a neutral reply with no tour promise, and word contact NEXT_STEPS so it doesn't claim local knowledge statewide. Add e2e: a Savannah listing shows no 'Request a tour' control and no in-person option. Don't mention referrals (out of scope).
3. **[high]** Printing is broken in dark mode, including for default users. 'Match my device' is the default, so anyone whose OS is dark who prints a listing (common in real estate) gets text in #ecebe4 on white paper, because browsers drop backgrounds when printing. No print styles exist in the repo (grep finds no `@media print` or `print:`), and the plan never mentions print.
   - **Fix:** Wrap both branches of the custom `dark` variant in `@media screen` (data-theme branch: `@media screen { &:where([data-theme=dark]…) }`; media branch: `@media screen and (prefers-color-scheme: dark)`), and add `@media print { :root { color-scheme: light } }`. Add an e2e test with `page.emulateMedia({media:'print', colorScheme:'dark'})` and `ar:theme="dark"` that asserts body color is rgb(21, 32, 28).
4. **[high]** Sync time limits are missing. Nothing bounds a run inside the 300 s `maxDuration`. The statewide daily incremental (thousands of changed records, 200 per page, plus RESO paging time) can be killed mid-run. The plan only marks stale `running` rows as failed afterwards. `?purge=1` also runs a full incremental before it purges, so a slow incremental means the purge (which IDX removal depends on) never runs. The 5% purge cap has no override, so after a few missed days the purge aborts every run and never recovers.
   - **Fix:** In GA-C2: (1) add a deadline to `syncSource` (for example `maxDuration − 45 s`). Stop between pages, record status 'partial' with the cursor saved, and let the next run resume. On Hobby, add a second daily call if backlog remains. (2) Make `?purge=1` purge-only (skip fetchUpdates). (3) Add an owner or CLI override (`--allow-large-purge`) and a dashboard warning when the cap trips. Acceptance: a fake provider with 50 slow pages ends 'partial' before the deadline, and the next run completes.
5. **[medium]** The DM1 premise is wrong for gradients. In Tailwind 4.3.3, gradient stops (`from-*`/`via-*`/`to-*`) resolve `["--background-color","--color"]` (checked in node_modules\tailwindcss\dist\lib.js), the same as `bg-*`. Overriding `--background-color-brand-700/800` in dark therefore also recolors: the hero fallback `from-brand-800` ((site)\page.tsx:44), auth-shell `from-brand-700 via-brand-800`, area and home card fallbacks `via-brand-700`, the avatar `from-brand-600 to-brand-800` (every agent without a photo), sell `from-brand-800`, and the `bg-brand-800` photo frames (area-card:30/71, page.tsx:197, areas\[slug]:396). This contradicts 'brand-800/900 panels fixed in both themes'. DM1 step 1 only has fallbacks for ring, decoration and accent.
   - **Fix:** Don't override `--background-color-brand-700/800`. Add a semantic `--color-primary` / `--color-primary-hover` pair (light #1a4c39/#163d2f, dark #2f7558/#1f5d45) and rename the ~10 primary-fill sites (button primary, location-search:157, homes\[slug]:532, filter-bar:149, site-header:171, about:261, account-forms:180, payment-calculator:10, location-map:34, photo-manager:282, listing-card:143) to `bg-primary hover:bg-primary-hover`. Extend the scratch check to confirm that `from-brand-800` resolves to `--color-brand-800`.
6. **[medium]** `src/lib/theme.ts` does read/write 'through local-store' and exports THEME_SCRIPT and THEME_COLORS, and the server `layout.tsx` imports those. `local-store.ts` imports `useState` and `useSyncExternalStore` from React and has no 'use client'. Next's server-component transform rejects client-hook imports in the server module graph ('This React Hook only works in a Client Component'), so DM1 fails at `next dev` or `build`. Lint and typecheck won't catch it.
   - **Fix:** Split the module: put STORE_KEYS in a React-free `src/lib/store-keys.ts` that local-store re-exports, and put THEME_COLORS and THEME_SCRIPT in a React-free `src/lib/theme-script.ts` that imports only store-keys. Keep the read/write/apply helpers that use local-store in a module imported only by client components. Update foundation.md and ARCHITECTURE.md 'Device storage' to list `ar:theme`.
7. **[medium]** The GA-C1 indexes and perf targets cover only sale with active/coming_soon. `price_desc` sorts `list_price desc, id asc`, which a `(list_price, id)` btree can't return in order, because a backward scan gives `id desc`. Rent mode, sold mode (sorted by `close_date`, with about 150k closed sales per year statewide kept by the close-date window), and the `pending` toggle (a 4-status IN that doesn't imply the partial predicate) get no index and no target. The 65k synthetic set has no closed or rent volume, so the Neon storage estimate and the sold-mode timings are unverified. A tiny rural bounds box combined with a sort index (worst case: the planner walks the whole sort index) isn't measured either.
   - **Fix:** Add `(list_price desc, id)` and the price-per-sqft direction to match `buildOrderBy` exactly. Add partial indexes for sold (`status='closed'`, on `close_date desc nulls last, id`) and rent. Add about 150k closed and 5k rent rows to `perf:seed`, and targets for sold, rent and pending page 1 and count, plus a small-box query that returns 3 results. Re-derive the storage estimate including closed listings and listing_media rows.
8. **[medium]** The sitemap and robots chunking pulls a database into the build. `src/app/sitemap.ts` says 'builds never need a database', and `robots.ts` is static. `generateSitemaps` needs a row count, and 'robots.ts lists every chunk' also needs one, so either the build queries the database or robots becomes dynamic and DB-backed. The chunk count also freezes at build while the feed grows.
   - **Fix:** Use a fixed upper bound: `generateSitemaps` returns ids 0..N−1 (for example 12, enough for 120k URLs), and empty chunks return []. List those fixed URLs in `robots.ts`, or serve one dynamic sitemap-index route handler. Add a unit test that robots and generateSitemaps import no database module, and a build check with DATABASE_URL unset.
9. **[medium]** `coverage.test.ts` as specified ('every seed-sites point … within 12 km of its area's center') fails on existing data. The lake rows spread about 21–28 km from their bbox center, and Jefferson and Gainesville reach about 12.3–12.9 km. For the consolidated city-counties (Augusta-Richmond, Columbus, Macon-Bibb, Athens-Clarke), 'town = inside the place' spans the whole county, often more than 12 km out. SeedArea also has no `center` field today.
   - **Fix:** Add an explicit `center` to SeedArea. In gen-seed-sites, limit the town pool to at most 8 km from the center and exclude the consolidated places' rural fringe. Set test radii per kind (core 1.2 km, town 8 km, rural 15 km, lake: the lake's own bbox + 3 km), and run the test against the existing 19 areas before adding the new ones.
10. **[medium]** The DM5 theme-guard test fails on the plan's own output. It forbids any `bg-ink/` in src/, but the plan deliberately keeps `hover:bg-ink/5` in save-button.tsx:52. Separately, the 'light screenshots byte-identical' regression (foundation criterion 6) has no automated harness. foundation.spec.ts says criterion 6 'lives elsewhere', and /homes includes network map tiles, so as written this check can neither fail nor pass reliably.

- **Fix:** Have the guard reject only `bg-ink/NN` for NN ≥ 20 and gradient `*-ink/`, or add save-button:52 to the allowlist. Add `e2e/theme-light-regression.spec.ts`: take `toHaveScreenshot` baselines of /, a listing and /saved at 1440×900 before DM1, mask the map canvas and photos, and have it fail on any diff.

11. **[medium]** The hand-offs miss owners and obligations. The plan edits WP6-owned files (dashboard\leads\page.tsx, listings-filter, photo-manager, agent-form, open-house-manager) but has no WP6 hand-off. It says `location-map.tsx` passes to WP3, but workpackages.md gives it and `location-map-lazy.tsx` to WP5. No package is told to keep new UI dark-safe (the shade/on-ink/surface rules, the guard test, a dark axe pass in each WP's acceptance). features.md F49 still says 'Dark mode itself is deferred'.

- **Fix:** Add a WP6 hand-off (lead cards and dashboard shell follow the tokens; add a dark axe run on /dashboard/leads and /dashboard/listings). Correct location-map ownership to WP5 and require WP5 to keep the theme dependency in location-map-lazy. Add a blanket rule for every WP: new pages run `expectNoSeriousAxe` in forced dark, and the theme-guard test must stay green. Update features.md F49.

12. **[medium]** Existing saved searches and alerts silently widen. A saved search with no `q` or bounds meant 'Northeast Georgia' while the site was regional. After the statewide cutover it matches the whole state, so the daily alert emails fill with Atlanta and Savannah homes the user never asked for. The first statewide import also counts as 'new' for listings under 7 days old.

- **Fix:** Add a cutover step and a migration: give saved searches created before the cutover with no location the firm counties' bounds (or a `county IN (...)` criterion), and add a unit test. Consider suppressing alerts for the source for one run after the filter widens (a `data_sources.config.alertsQuietUntil`).

13. **[medium]** The 'Handpicked by our agents' featured block becomes a false firm statement. `getFeaturedListings` (queries.ts:73) orders by isFeatured and then isCompanyListing, then falls back to the newest active listing, so with a statewide feed the block fills with other brokerages' Savannah or Atlanta homes under 'Homes our team knows inside and out'. GA-A only caches this function.

- **Fix:** In GA-A, restrict featured to `isCompanyListing OR isFeatured`, or to `isFirmArea`, and hide the section or change its copy when fewer than 4 qualify. Add e2e: every card in that section is an Adams listing or lies in the firm's counties.

14. **[medium]** The desktop and phone switches use `md:` instead of the foundation's `phone:`/`wide:` shell contract. On the iphone13-landscape project (a 'phone' by PHONE_QUERY), `hidden md:flex` shows the header sun/moon button while the `md:hidden` mobile menu with the segmented control is unreachable. This contradicts 'phones get no sun/moon button', and the mobile theme spec skips that project.

- **Fix:** Use `hidden wide:flex` for ThemeMenuButton. Render AppearanceControl in the phone menu with `phone:`, or ensure the landscape menu carries it. Run e2e/mobile/theme.spec.ts on iphone13-landscape and ipad-mini too.

15. **[medium]** `payment-calculator` defaults in site.finance (insurance 0.6% of price, fallback tax 0.9%) were tuned for rural Northeast Georgia (the comment says so). Applied statewide, they understate coastal homes (Savannah, Brunswick insurance, flood) and metro Fulton and DeKalb taxes. That undercuts the 'honest monthly costs' promise that GA-A copy repeats statewide. GA-A only rewords the comment.

- **Fix:** Add per-county or per-region overrides (a coastal set of Chatham, Glynn, Camden, Liberty, Bryan, McIntosh for insurance, and metro millage fallbacks), or label the estimate 'Northeast Georgia averages; your costs may differ' outside the firm's area. Unit-test the chosen rate for Savannah vs Royston.

16. **[low]** The map theme switch has holes. SearchMap is `ssr:false`, but it still renders during the hydration pass, where `useResolvedTheme()` returns null, so the map may be created with the light style and then immediately `setStyle`d (double fetch, light flash). Images from `addImage` ('pill', 'pill-active') are not part of the style, so after `setStyle` the transformStyle-carried pin layers fire `styleimagemissing` until `style.load`, and pills blink despite the 'pins never blink' claim. A custom dark style whose glyphs lack 'Noto Sans Bold' drops every label silently.

- **Fix:** In the map effect, compute the theme synchronously (`resolveTheme(readThemePref(), matchMedia(...).matches)`) instead of from the hook's first value. Register `map.on('styleimagemissing')` to add the pill images synchronously. In DM4 e2e, assert that `map.queryRenderedFeatures({layers:['pins']}).length > 0` after a switch, and that no glyph request returns 404.

17. **[low]** The no-flash and hydration tests are brittle or too weak. React Float and Next hoist async chunk `<script src>` tags to the top of `<head>`, so 'the first `<script>` in `<head>` contains ar:theme' fails even when the page works. The hydration check (/hydrat/i) misses React 19's dev warning about rendering `<script>` tags, which Next's own guide (node_modules\next\dist\docs\01-app\02-guides\preventing-flash-before-hydration.md) handles with an InlineScript helper. A page restored from bfcache after a theme change in another tab doesn't re-sync, because storage events don't reach frozen pages.

- **Fix:** Assert that the first inline script (no src) contains ar:theme and precedes `<body>`. Use the docs' InlineScript pattern (type text/javascript on the server, text/plain on the client, with suppressHydrationWarning). Fail on any console error or warning in dark. Add a `pageshow` (persisted) listener to ThemeSync that re-applies the stored preference, with a unit test.

18. **[low]** The location_vector definition and the q=Atlanta acceptance are wrong as written. `to_tsvector('simple', address, city, zip, neighborhood, mls_number)` isn't valid SQL (to_tsvector takes one text argument, and the columns are `address_line1` and `postal_code`, which need coalesce). 'Rows equal the listings whose city is Atlanta' contradicts the kept address ILIKE and trigram branch: real addresses like 'Atlanta Hwy' in Athens or Gainesville also match.

- **Fix:** Write it as `to_tsvector('simple', coalesce(address_line1,'')||' '||coalesce(city,'')||' '||coalesce(postal_code,'')||' '||coalesce(neighborhood,'')||' '||coalesce(mls_number,''))`. Restate the acceptance as 'contains every city=Atlanta listing and no listing that matches only on description', and put an 'Atlanta Hwy, Athens' row in the perf fixture.

19. **[low]** Area-guide and firm-area matching is by name only. `areaCondition` and `guideForLocation` match neighborhood names statewide. With the statewide feed, subdivisions elsewhere named 'Jefferson', 'Commerce', 'Lanier' or 'Martin' land in Northeast Georgia guide stats, and `isFirmArea` returns true for them.

- **Fix:** Scope neighborhood matches to the guide's `counties` (add `county = ANY(guide.counties)` when the listing has a county). Unit-test a neighborhood named 'Jefferson' in Chatham County: it is not in the Jefferson guide, and `isFirmArea` returns false.

20. **[low]** Tailwind v4 inlines named shadows. `shadow-card`/`lift`/`pop` compile to literal values (`e.get(['--shadow-card'])` in lib.js), so the dark `--shadow-*` values in the palette table change only the one raw `var(--shadow-pop)` use (the MapLibre popup). The save heart pairs `fill-clay-500` (not namespaced, stays #c2562a) with `text-clay-500` (namespaced, becomes #e07b4f), so its outline and fill mismatch in dark.

- **Fix:** Either drop the shadow row (the approved preview looked the same) or define shadows with an inner variable (`--shadow-card: 0 1px 2px var(--shadow-ink-a) …`) and redefine only that variable in dark. Add `--fill-color`? No: add `dark:fill-[var(--text-color-clay-500)]` or rename the heart to one semantic token.

21. **[low]** Small inaccuracies in the scope statement and baseline. GA-A2 edits the paragraphs that contain the never-sell and no-ads sentences ((site)\page.tsx:160, site-footer:79–80), which contradicts 'No step edits those sentences'. The working-tree `site.description` ends 'and no ads.' while HEAD ends 'and no ads — ever.', so the plan's 'must keep "no ads — ever"' check uses the wrong baseline (possibly a foundation edit, possibly the mutation run). Emails stay light (email-templates.ts:306 declares color-scheme light), but the plan doesn't say so.

- **Fix:** Restate the out-of-scope rule as 'the no-ads and never-sell clauses are kept word for word', and add an e2e/unit check that compares those clauses against a fixed list. Re-read site.ts after the mutation run and keep whatever promise wording is committed, without adding '— ever'. Add one line: transactional and alert emails stay light-only by design.

---

Branch `mobile`, repo `C:\Dev\adams-realty-website`. This plan runs after the mobile foundation is committed and before WP2. Every file named here is either lead-owned or is a handed-off file whose package (WP2–WP5) hasn't started, so the lead edits it directly. When each package starts, it inherits the result and the obligations listed under "Hand-offs to the work packages".

Out of scope: ads, selling or sharing leads, and any change to the no-ads / never-sell sentences. No step edits those sentences, and GA step A7 includes a check that they survive.

---

## 0. Order, parallelism and file ownership

| Package                                                | Commits                                                                        | Touches                                                                                                                                                                                                                                                                                                                                                                                     | Depends on                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **DM** Dark mode                                       | DM1 tokens + mechanism, DM2 renames, DM3 switch UI, DM4 maps, DM5 tests + docs | globals.css, layout.tsx, `src/lib/theme.ts`, `src/components/theme/*`, ui primitives, ~30 component/page files (class renames only), `map-setup.ts`, `search-map.tsx`, `location-map.tsx`                                                                                                                                                                                                   | foundation commit                                                                    |
| **GA-B** Statewide demo data                           | 1 commit                                                                       | `scripts/seed.ts`, `scripts/seed-data.ts`, `scripts/seed-sites.json`, new `scripts/dev/gen-seed-sites.ts`, new `src/config/coverage.test.ts` (added with GA-A)                                                                                                                                                                                                                              | nothing                                                                              |
| **GA-C** Scale: indexes, query, sync, sitemap, caching | 2 commits (C1 DB + query, C2 sync + sitemap + cache)                           | `drizzle/0004_*`, `src/db/schema/listings.ts`, `src/lib/search/query.ts` (+test), `src/lib/mls/sync.ts`, `src/lib/listings/persist.ts`, `src/lib/mls/reso/provider.ts`, `src/app/api/cron/sync/route.ts`, `src/app/sitemap.ts`, new `src/app/homes/sitemap.ts`, `src/app/robots.ts`, new `src/lib/listings/cached.ts`, `vercel.json` (only if the owner approves Pro), new `scripts/perf/*` | nothing                                                                              |
| **GA-A** Config, copy, map default view                | 1 commit                                                                       | `src/config/site.ts`, `layout.tsx` (title), `homes/page.tsx`, `search-view.tsx`, `(site)/page.tsx`, `contact/page.tsx`, `site-footer.tsx`, `homes/[slug]/page.tsx`, `inquiries.ts`, `about/page.tsx`, `search-map.tsx` (one hunk), new `src/lib/areas/firm-area.ts` (+test), docs                                                                                                           | DM (shares 7 files), GA-B (its e2e needs the new places), GA-C1 (the cached callers) |

**Landing order on `mobile`:** DM → GA-B → GA-C1 → GA-C2 → GA-A → docs. Each commit is green before the next one lands.

**Parallel work:** GA-B and GA-C touch no file that DM touches, so they can be written while DM is in progress. Write them in a separate worktree (`git worktree add C:\Dev\adams-realty-ga mobile`, dev server on port 3001, database `adams_ga` on the shared Postgres), because one checkout can't run two `next dev` servers. Rebase onto `mobile` after DM lands, then run the full checks there. GA-A must be serial after DM: it edits `(site)/page.tsx`, `site-footer.tsx`, `search-view.tsx`, `homes/[slug]/page.tsx`, `about/page.tsx`, `contact/page.tsx` and `search-map.tsx`, which DM also edits.

**Owner of `search-map.tsx`: DM.** DM restructures it (overlays installed on `style.load`, theme-driven `setStyle`). GA-A changes one hunk after DM lands: the initial camera fallback, and removing `site.market.center`/`zoom`. `map-setup.ts` and `location-map.tsx` also belong to DM. WP3 inherits all three.

**Checks after every commit** (the "full checks" in the rest of this plan):

1. `npm run lint && npm run typecheck && npm test`
2. `npm run db:reset` (required after GA-B and GA-C1)
3. `npx playwright test`, all six projects: desktop, mobile, pixel7, iphone13, iphone13-landscape, ipad-mini
4. `npm run build` (production build; `next dev` keeps its own output directory, so the build can run while the dev server is up)

---

## DM — Dark mode

features: three-way appearance (Match my device (default) / Light / Dark); desktop sun/moon menu; mobile "Appearance" segmented control; dark map style.
owns (during DM): `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/local-store.ts` (STORE_KEYS only), `src/components/ui/{button,form,popover,toast}.tsx`, `src/components/search/{map-setup.ts,search-map.tsx}`, `src/components/listings/location-map.tsx`, plus class-only edits in the files listed in DM2.
new: `src/lib/theme.ts`, `src/lib/theme.test.ts`, `src/lib/theme-guard.test.ts`, `src/components/theme/{use-theme.ts,theme-sync.tsx,appearance-control.tsx,theme-menu-button.tsx}`, `e2e/theme-suite.ts`, `e2e/theme.spec.ts`, `e2e/mobile/theme.spec.ts`.

### Design decisions (settled; don't reopen during implementation)

- **Mechanism: CSS tokens, a two-branch `dark` variant and one inline head script.** No cookie, no server read, no `light-dark()`, and no `filter`/`invert` on `html`, `body` or wrappers.
- **"Match my device" means no `data-theme` attribute.** Light and Dark set `data-theme="light"` or `"dark"` on `<html>`.
- **Dual-role greens are split through Tailwind v4 per-utility namespaces** (`--text-color-*`, `--background-color-*`, `--border-color-*`, `--outline-color-*`, `--ring-color-*`, `--text-decoration-color-*`, `--accent-color-*`). This covers the inventory's 90 dual-role brand-text items, including their `hover:`/`group-hover:` forms, with **zero class edits**. The inventory's `accent`/`accent-strong`/`accent-soft` renames are therefore not used.
- **Only three role conflicts get renames, each pixel-identical in light mode:** `shade` (photo, map and lightbox overlays, plus toasts), `on-ink` (labels on solid `bg-ink`), and `bg-surface` (white chips and buttons on photos). Light screenshots (foundation criterion 6) must stay byte-identical.
- **Fixed in both themes:** photos, photo overlays, brand-800/900 panels, the lightbox and **toasts** (dark in both themes), and **map pins, clusters and price pills**, as in the approved screenshot.
- **Over the hero in dark mode, the Sign in pill and the active Buy/Rent/Sold tab turn dark (surface)**, as the approved preview shows.
- **Phones get no sun/moon button in the header.** The button is `hidden md:flex`, and the mobile menu carries the segmented control. This matches the brief and WP2's "phone header shows only logo and hamburger".
- **Labels:** the desktop menu says "Match my device / Light / Dark". The mobile segmented control says "Auto / Light / Dark", as in the approved preview, and "Auto" carries a visually hidden "(match my device)".

### DM1 — Tokens, variant, persistence, no-flash, theme-color

1. **Scratch-verify the namespaces first** (outside the repo, with the repo's tailwindcss 4.3.3). Compile `text-brand-700 hover:text-brand-700 group-hover:text-brand-700 bg-brand-700 border-brand-500 outline-brand-500 ring-brand-100 ring-brand-500 decoration-brand-200 accent-brand-700 from-ink/80`. Confirm each color utility reads its namespace variable, and that gradient stops read `--color-*`. If `ring`, `decoration` or `accent` don't honor a namespace, rename just those sites to a semantic token (`ring-focus-halo`, `decoration-link`, `accent-check`) and add them to the DM2 list.
2. **`src/app/globals.css`, the variant.** Replace the built-in media-only `dark` with:
   ```css
   @custom-variant dark {
     &:where([data-theme="dark"], [data-theme="dark"] *) {
       @slot;
     }
     @media (prefers-color-scheme: dark) {
       &:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *) {
         @slot;
       }
     }
   }
   ```
3. **`globals.css`, the tokens.** The light values in `@theme` stay as they are. Add the new tokens to `@theme` at their light values, then write one block, `:root { color-scheme: light; @variant dark { color-scheme: dark; …dark values… } }`, which Tailwind emits under both selectors.

   **Exact palette.** Start from the approved `dark.css`; the corrections it needed are marked ✱.

   | Token                                      | Light (unchanged or new)              | Dark                                                                                                                                    |
   | ------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
   | canvas / surface / sunken                  | #fbfaf7 / #ffffff / #f4f2ec           | #0f1412 / #171e1b / #0b0f0d                                                                                                             |
   | ink / ink-soft / muted / faint             | #15201c / #3b4843 / #66716c / #68716d | #ecebe4 / #c9cdc5 / #a0a8a1 / #8d968f                                                                                                   |
   | line / line-strong                         | #e8e4db / #d6d1c4                     | #252e2a / #36413b                                                                                                                       |
   | brand-50 / 100 / 200 / 300                 | #eef5f1 / #d6e8de / #aed1bf / #7db39a | #13251d / #1a3327 / #24483a / #3c6e57                                                                                                   |
   | brand-400 … 900                            | unchanged                             | **not redefined** (fills)                                                                                                               |
   | brass-100 / 500 / 700                      | #f5ecdc / #8a6a2f / #7d5a26           | #2b2317 / #d2a869 / #dcb57c                                                                                                             |
   | brass-400, status-*                        | unchanged                             | not redefined                                                                                                                           |
   | clay-50                                    | #fbefe8                               | #2c1913                                                                                                                                 |
   | clay-500 / clay-600 (palette)              | #c2562a / #a8461f                     | **✱ not redefined.** dark.css's #e07b4f/#ec8f66 drop white labels to 2.95:1 and 2.42:1 on the card badge, danger button and error toast |
   | shadow-card / lift / pop                   | unchanged                             | dark.css's black-alpha values                                                                                                           |
   | **new** `--color-shade`                    | #15201c                               | #15201c (never redefined)                                                                                                               |
   | **new** `--color-on-ink`                   | #ffffff                               | #0f1412                                                                                                                                 |
   | **new** `--color-map`                      | #eef0ec                               | #0c0c0c (OpenFreeMap dark background)                                                                                                   |
   | `--text-color-brand-500 / 600 / 700 / 800` | #2f7558 / #1f5d45 / #1a4c39 / #163d2f | #7cc3a2 / #86c8a8 / #93d0b2 / #b5e1cb                                                                                                   |
   | `--text-color-brand-200`                   | #aed1bf                               | **✱ #aed1bf, held** (toast action on shade)                                                                                             |
   | `--text-color-brass-100`                   | #f5ecdc                               | **✱ #f5ecdc, held** (pale text on photos and brand-900)                                                                                 |
   | `--text-color-clay-500 / 600`              | #c2562a / #a8461f                     | #e07b4f / #ec8f66 (text only)                                                                                                           |
   | `--text-color-status-soon`                 | #7a5af5                               | #a590ff                                                                                                                                 |
   | `--background-color-brand-700 / 800`       | #1a4c39 / #163d2f                     | #2f7558 / #1f5d45 (primary fill and hover; white 5.5:1)                                                                                 |
   | `--border-color-brand-500 / 600 / 700`     | #2f7558 / #1f5d45 / #1a4c39           | #4f9274 / #86c8a8 / #93d0b2                                                                                                             |
   | `--outline-color-brand-500`                | #2f7558                               | #4f9274 (focus, about 5:1)                                                                                                              |
   | `--ring-color-brand-100`                   | #d6e8de                               | rgb(79 146 116 / 0.3) (focus halo and hairline)                                                                                         |
   | `--ring-color-brand-500`                   | #2f7558                               | #4f9274 (card highlight)                                                                                                                |
   | `--text-decoration-color-brand-200 / 600`  | #aed1bf / #1f5d45                     | rgb(147 208 178 / 0.4) / #93d0b2                                                                                                        |
   | `--accent-color-brand-700`                 | #1a4c39                               | #4f9274 (checked checkbox)                                                                                                              |

   Write every light value as a literal hex equal to today's palette, so light mode is unchanged.

4. **Other `globals.css` changes:**
   - `::selection`: text uses `var(--color-ink)`.
   - `dialog::backdrop`: alpha 0.7 in dark.
   - Autofill: `input:-webkit-autofill { -webkit-text-fill-color: var(--color-ink); box-shadow: 0 0 0 1000px var(--color-surface) inset }`.
   - MapLibre, under `@variant dark`:
     - `.maplibregl-popup-content`: background surface, color ink (in both themes, use `var(--color-surface)`).
     - `.maplibregl-ctrl-group`: background surface; box-shadow `0 0 0 1px var(--color-line)`.
     - `button + button`: border-top uses line.
     - `.maplibregl-ctrl-icon { filter: invert(1) }`. This is scoped to the icon element only, which has no descendants.
     - `.maplibregl-ctrl-attrib.maplibregl-compact`: background surface, color muted, links ink-soft; the compact button is inverted.
   - Theme switch without a colour fade: `[data-theme-switching] * { transition: none !important }`.
   - Don't touch the z-scale, the chrome markers, the phone/wide variants or the full-screen-search ancestor rule.
5. **`src/lib/local-store.ts`:** add `STORE_KEYS.theme = "ar:theme"`. The value is the JSON string `"light"` or `"dark"`; no key means Match my device. `clearRecents()` and `clearUserCaches()` must not remove it.
6. **`src/lib/theme.ts`** (pure, no React):
   - `ThemePref = "system" | "light" | "dark"`, `parseThemePref`, `resolveTheme(pref, systemDark)`.
   - `readThemePref` and `writeThemePref`, both through local-store. Writing `system` removes the key.
   - `applyTheme(pref, doc)`: sets or removes `data-theme`, keeps `meta#theme-color-override`, and sets `data-theme-switching` for one frame.
   - `THEME_COLORS = { light: "#fbfaf7", dark: "#0f1412" }`.
   - `setChromeColor(color | null)` for WP2's F49.
   - `THEME_SCRIPT`: a constant ES5 string, built from STORE_KEYS.theme and THEME_COLORS, wrapped in try/catch. It sets `data-theme` and prepends `<meta name="theme-color" id="theme-color-override">` only for a forced Light or Dark.
7. **`src/app/layout.tsx`:**
   - `<html suppressHydrationWarning>`, with `<script dangerouslySetInnerHTML={{__html: THEME_SCRIPT}} />` first in `<head>`.
   - `viewport.themeColor` becomes `[{ media: "(prefers-color-scheme: light)", color: THEME_COLORS.light }, { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark }]`.
   - Mount `<ThemeSync />`.
   - `viewportFit` and `interactiveWidget` are unchanged, and there is no `colorScheme` viewport meta.
   - The skip link's `text-white` becomes `text-on-ink`.
8. **`src/components/theme/theme-sync.tsx`:**
   - Re-applies the stored preference in `useLayoutEffect`, which covers the dev Strict Mode remount.
   - Subscribes through local-store `subscribe()`, which covers same-tab writes and the cross-tab `storage` event, and to `matchMedia("(prefers-color-scheme: dark)")`.
   - Renders nothing and has no `aria-live`.
9. **`src/components/theme/use-theme.ts`:** `useThemePref()` (via `useLocalValue`) and `useResolvedTheme()` (`"light" | "dark" | null`; null on the server and during hydration).
10. **Checks:** run the full checks. With no preference set and a light OS, light-mode screenshots are unchanged.

### DM2 — Treatments by inventory category (the renames)

Each item cites the inventory's file:line. A **✔** means no edit is needed, because the namespace tokens already handle it.

- **dual-role-brand-text (90) ✔.** Namespace tokens handle all of them, including `hover:`, `group-hover:`, `decoration-*`, `border-brand-600/700`, `after:outline-brand-500` and `ring-brand-500` (listing-card:55). No class edits.
- **dual-role-tint (21) ✔**, except `primitives-demo.tsx:138` (dev only), which changes to `from-brand-400`. The pale text on photos and brand-900 (page.tsx:55, :142; about:161; contact:62; sell:57) stays `text-brass-100`, which is held at #f5ecdc.
- **dual-role-fill (21):**
  - `bg-brand-700` (button primary, location-search:157, homes/[slug]:532, filter-bar:149, site-header:171, about:261, account-forms:180, payment-calculator:10, location-map:34) ✔ through `--background-color-brand-700`.
  - Clay fills (button danger, toast error, listing-card clay badge) ✔, because the clay palette is no longer redefined.
  - `status-soon` text (dashboard/ui.tsx:74) ✔ through `--text-color-status-soon`.
  - Status dots and badges on photos: keep.
- **focus-indicator (8) ✔** through `--border-color-brand-500`, `--ring-color-brand-100` and `--outline-color-brand-500`. That covers form.tsx:6, lead-controls:22, listings-filter:158, location-search:114, payment-calculator:175, popover:93, photo-manager:256, open-house-manager:301 and the global `:focus-visible`.
- **ink-inversion (13): rename `text-white` → `text-on-ink` on solid `bg-ink`.** Sites:
  - layout.tsx:64
  - site-header.tsx:117
  - homes/[slug]/page.tsx:174
  - filter-bar.tsx:187 and :277
  - pagination.tsx:52
  - dashboard/leads/page.tsx:78
  - listings-filter.tsx:118
  - listings-filter.tsx:125 (`bg-white/15 text-white` → `bg-on-ink/15 text-on-ink`)
  - market-snapshot.tsx:151 and :161 (`text-white/70` → `text-on-ink/70`)
  - **Toast (toast.tsx:184–185, 197–198) goes to `shade` instead**: `bg-ink` → `bg-shade`, plus `dark:ring-1 dark:ring-white/10`. Its `text-white`, `hover:bg-white/10` and `text-brand-200` action stay.
- **white-literal-follow (18): rename to `surface`.**
  - site-header.tsx:116 → `bg-surface text-ink hover:bg-surface/90`
  - hero-search.tsx:31 → `bg-surface`
  - listing-card.tsx:69 → `bg-surface/95`; :147 → `bg-surface text-brass-700`; :309 → `bg-surface/90 hover:bg-surface`
  - save-button.tsx:48 → `bg-surface/90 hover:bg-surface`
  - photo-gallery.tsx:75 → `bg-surface/95 hover:bg-surface`
  - area-card.tsx:37 → `bg-surface/95`
  - areas/[slug]/page.tsx:407 and :422 → `bg-surface/95`
  - photo-manager.tsx:282 (white branch) and :294 → `bg-surface/90 hover:bg-surface`; `ring-white` stays
  - **Inverse button (button.tsx:13) keeps `bg-white` and changes `text-ink` → `text-shade`.** That one change fixes its 5 consumers (about:178, area-cta:24, fair-housing:206/232/244).
- **white-literal-keep (50):** no change.
- **photo-overlay-ink (20): rename to `shade`.**
  - (site)/page.tsx:44 `to-ink` → `to-shade`; :46 → `from-shade/85 via-shade/35 to-shade/40`; :99 → `bg-shade/25 hover:bg-shade/40`; :208 → `from-shade/80 via-shade/10`
  - area-card.tsx:121
  - auth-shell.tsx:33
  - listing-card.tsx:75 and :148
  - photo-gallery.tsx:69 (`bg-shade/0 group-hover:bg-shade/10`) and :85 (`bg-shade/95`)
  - search-view.tsx:215
  - agent-form.tsx:484
  - popover.tsx:111 (`bg-shade/30`, plus `dark:bg-shade/50`)
  - save-button.tsx:52 `hover:bg-ink/5` stays: it is a hover tint that should follow the theme.
  - The brand-900 gradients and fallbacks stay.
- **hardcoded-color (20):**
  - themeColor was handled in DM1.
  - form.tsx:23: add a `dark:` chevron data-URI with fill `%23a0a8a1`.
  - search-map.tsx:364 and location-map.tsx:41: `bg-[#eef0ec]` → `bg-map`.
  - The map styles are DM4.
  - The pill, cluster and pin colours stay, gathered into one `MAP_OVERLAY_COLORS` const.
  - Brand-panel glows and the stats.ts data colours stay. Check `#1f7a55` (about 3.2:1) in the dark axe run, and lighten it for dark only if it fails.
  - `appleWebApp.statusBarStyle` is flagged for WP1 and not changed here.
- **globals-css (11) and third-party-ui (14):** handled in DM1. Native selects, date and number inputs, checkboxes and scrollbars follow `color-scheme`. The checkbox follows `--accent-color-brand-700`.
- **images-svg (5):** no change. The logo tile, icon.svg and the Google G are self-contained; the Equal Housing logo uses `currentColor`.
- **Checks:** run the full checks. Light screenshots are byte-identical, and axe in light still reports 0 contrast violations (foundation criterion 4).

### DM3 — The switch

1. **`src/components/theme/appearance-control.tsx`:** `<AppearanceControl variant="segmented" | "list" />`.
   - A `<fieldset>` with the legend "Appearance" and three native `<input type="radio">` inside labels. Icons: Monitor, Sun, Moon.
   - Segmented labels: "Auto" (with sr-only "(match my device)"), "Light" and "Dark". List labels: "Match my device", "Light" and "Dark", with a check on the selected one.
   - Each option is `pointer-coarse:h-11` and uses the focus ring from `:focus-visible`.
   - No `aria-live` and no `role=status`, so /homes keeps exactly one `[aria-live=polite]`.
   - Choosing an option calls `writeThemePref` and then `applyTheme`.
2. **`src/components/theme/theme-menu-button.tsx`:** `<ThemeMenuButton transparent />`.
   - It uses the existing `Popover` with `unstyled`, `showChevron={false}`, `fixedOnMobile={false}` and `align="end"`, the same way `UserMenu` does, with the list variant inside.
   - The trigger shows a Sun (`dark:hidden`) or a Moon (`hidden dark:block`), so it is correct before hydration.
   - Its accessible name is a static sr-only "Appearance".
   - Styles come from the header's existing `transparent` classes (white on the hero photo).
   - Choosing an option leaves the menu open. Escape, an outside tap and focus return work as they already do in Popover.
3. **Mount now:**
   - `site-header.tsx`: `<ThemeMenuButton>` wrapped in `hidden md:flex`, first in the right-hand cluster before Saved.
   - `<AppearanceControl variant="segmented">` at the bottom of the existing `md:hidden` mobile menu block, below a divider.
   - No change to `[data-site-header]`, `HeaderUser.id` or the TabBar stub.
4. **Checks:** run the full checks.

### DM4 — Maps

1. **`map-setup.ts`:** add `mapStyleUrl(theme)`.
   - Light: `NEXT_PUBLIC_MAP_STYLE_URL` if set, otherwise OpenFreeMap positron.
   - Dark: `NEXT_PUBLIC_MAP_STYLE_DARK_URL` if set; otherwise the custom light URL if one is set; otherwise `https://tiles.openfreemap.org/styles/dark`. This keeps the privacy page's statement true.
   - Document both variables in README/.env.example.
2. **`search-map.tsx`:**
   - Move the image, source and layer setup out of `map.on("load")` into `installOverlays(map)`, bound to `style.load`. Guard it with `getSource`/`getLayer`/`hasImage` so it is safe to run more than once, and re-apply the highlight filter from a latest-ref.
   - Event handlers stay registered once.
   - Create the map with `mapStyleUrl(useResolvedTheme())`; it is `ssr:false`, so the theme is known at mount.
   - When the theme changes, call `map.setStyle(url, { transformStyle })`. `transformStyle` carries over the `listings` source and the overlay layers, so pins never blink.
3. **`location-map.tsx`:** add the resolved theme to the effect's dependencies and recreate the map. Its DOM marker already uses `bg-brand-700`, which is handled by the tokens.
4. **Checks:** run the full checks.

### DM5 — Tests and docs

**Unit tests** (Vitest, node environment, with fakes):

- `src/lib/theme.test.ts`:
  - `parseThemePref`: valid values, "blue", numbers, null.
  - `readThemePref` against Map-backed and throwing storage.
  - `writeThemePref`: system removes the key; the other values write JSON and notify subscribers.
  - `resolveTheme` truth table.
  - `applyTheme` on a fake `documentElement`/`head`.
  - `THEME_SCRIPT` run through `new Function` against a fake `localStorage` and document: dark, light, garbage, and a throwing store.
  - Drift checks: `THEME_COLORS` equals `--color-canvas` in both the `@theme` block and the dark block of globals.css; the custom variant contains both selectors; `THEME_SCRIPT` contains `STORE_KEYS.theme`.
- `src/lib/theme-guard.test.ts`: fails if `src/` contains `bg-ink/`, `from-ink`, `via-ink`, `to-ink`, `text-white` in the same class string as a solid `bg-ink`, or a solid or /90–/95 `bg-white` outside an allowlist. The allowlist is: the switch knob (account-forms:185), the carousel dots (listing-card:282) and the inverse button.

**e2e:** `e2e/theme-suite.ts` holds the shared cases. `e2e/theme.spec.ts` runs them on desktop, and `e2e/mobile/theme.spec.ts` on pixel7 and iphone13.

1. **No flash:**
   - With an init script setting `ar:theme` to `"dark"` and every `/_next/static/**/*.js` aborted, `/` has `html[data-theme=dark]`, body background `rgb(15, 20, 18)`, and a first `meta[name=theme-color]` of `#0f1412`.
   - `request.get("/")` returns an `<html>` with no `data-theme`, and the first `<script>` in `<head>` contains `ar:theme`.
2. **Zero JS:** a `javaScriptEnabled:false` context with `colorScheme:"dark"` shows the dark canvas; with `"light"` it shows the light one.
3. **Persistence:**
   - Pick Dark (header menu on desktop, mobile menu on pixel7), reload: still dark.
   - Follow a link to `/homes`: still dark.
   - `localStorage["ar:theme"] === '"dark"'`.
4. **Match my device:**
   - Choosing it removes both the key and the attribute.
   - `emulateMedia({colorScheme})` flips the canvas live.
   - A forced Light under an OS dark emulation stays light.
5. **Cross-tab:** a second page in the same context follows the change.
6. **Map:**
   - Switching the theme on `/homes` issues a request matching `/styles\/dark/`, and switching back one matching `/styles\/positron/`.
   - The map canvas is still present, pin layers are queryable (`map.getLayer("pins")`, exposed only in dev), and there are no console errors.
7. **Keyboard:** Tab to the trigger, press Enter, Tab into the group, ArrowDown selects Dark, Escape returns focus to the trigger.
8. **Touch targets:** `expectTapTargets` of at least 44px on the segmented radios on pixel7. On phones the header has no theme button, and on desktop it has one.
9. **Hydration:** no console error matching `/hydrat/i` with dark forced.
10. **Axe:** `expectNoSeriousAxe` reports **0 color-contrast** and 0 serious or critical issues with Dark forced, and again with system dark emulated.
    - Desktop: `/`, `/homes`, the first listing, `/sign-in`, `/saved` (buyer), `/about`, `/fair-housing`, `/areas/<first guide>` and `/dashboard/leads` (staff).
    - pixel7: `/`, `/homes`, the first listing, `/sign-in`, `/saved` and `/about`.
    - Contrast can never be allowlisted.
11. **Light regression:** foundation criterion 6's light screenshots are unchanged.

**Manual visual check:** capture dark screenshots of the 8 pages from the approved preview and compare them with `darkpreview/shots`. Axe can't judge text over photos or the map canvas: hero chips, card badges, map pills and the Sign in pill over the hero.

**Docs:**

- ARCHITECTURE.md gets a "Themes" section: the variant, the token table, the `shade` / `on-ink` / `surface` rules, `ar:theme`, and the theme files and `map-setup.ts` as lead-owned.
- workpackages.md gets the hand-offs listed at the end of this plan.

**Acceptance (DM):** all of the above pass, then run the full checks.

---

## GA — All of Georgia

Principle: **listing coverage becomes Georgia; statements about the firm stay Northeast Georgia; area guides stay.** Copy says "across Georgia, from Georgia MLS" and never "every home in Georgia".

### GA-B — Statewide demo data (seed)

1. **`scripts/seed-data.ts`:**
   - Add `SeedArea.urban` (never rural; no farm or manufactured homes) and `SeedArea.mountainViewChance`. Draw `chance()` only when the field is set: Toccoa 0.2, Blue Ridge 0.5, Dalton 0.15. The Northeast Georgia random sequence must not shift.
   - Add a `"neighborhood"` kind (city Atlanta, neighborhood "Virginia-Highland").
   - Add per-area phone area codes.
   - Add `COUNTY_DISTRICTS` for the 18 new counties: Fulton, DeKalb, Cobb, Clarke, Richmond, Chatham, Bibb, Muscogee, Floyd, Whitfield, Fannin, Houston, Baldwin, Bulloch, Glynn, Dougherty, Lowndes, Thomas. Check each district name against the district's own site.
   - Add `STATEWIDE_AREAS`: 20 areas, about 226 listings, all `ourWeight 0`. Use the research's centers, $/sqft, size, type mix, vibe and quota:
     - Metro Atlanta (86): Atlanta 30, Virginia-Highland 8, Decatur 22, Marietta 14, Alpharetta 12.
     - Regional cities (68): Athens 14, Augusta 14, Savannah 16, Macon 12, Columbus 12.
     - North (24): Rome 8, Dalton 6, Blue Ridge 10.
     - Middle and south (48): Warner Robins 8, Milledgeville 6, Statesboro 6, Brunswick 8, Albany 6, Valdosta 8, Thomasville 6.
   - A vibe must never name another town. Avoid Savannah River, Forsyth Park, Kennesaw Mountain, Avalon and Cohutta.
   - Fix Braselton's vibe from "Michelin Raceway Road Atlanta" to "close to Château Élan's vineyards and golf". This changes text only and draws no extra random numbers.
2. **`scripts/seed.ts`:**
   - Generate the statewide block **after** the saved-search insert, with the PRNG re-seeded (`state = 20260926`). Listing keys continue from `DEMO-00181`.
   - Use `ours=false` with `OTHER_BROKERAGES`, so there are never Adams listings outside Northeast Georgia and `?ourListings=1` fixtures don't change.
   - MLS numbers are derived from the index, so they are unique.
   - Phones use the `555-01XX` range for fiction, with the same single `rand()` draw as today.
   - Force status `active` for the first 12 Decatur sale listings, the first 4 DeKalb listings and the first 2 Virginia-Highland listings.
   - Seed-time assertions, which throw if they fail:
     - `/homes?q=Decatur` in buy mode has at least 10 results;
     - at least 1 Decatur listing has 3 or more beds;
     - there is at least 1 DeKalb listing and at least 1 Virginia-Highland listing;
     - every `featuredAreas` entry has at least 1 result;
     - there are no more than 750 live listings in total.
   - Update the header comment and the "By area" log.
3. **`scripts/dev/gen-seed-sites.ts`:** dev-only, needs the network, never run in CI.
   - Uses Census TIGERweb (places, counties, ZCTAs, military land) and USGS NHD (water, marsh, sea/estuary).
   - Pools: core (inside the place, within 1.2 km of the center), town (inside the place) and rural (1–7 km outside the place, inside the county, not in any other incorporated place).
   - Rows are `[lat, lng, county, city, zip]`. Pool sizes: town at least quota + 4, core at least quota / 2, rural at least quota (non-urban only).
   - Commit the script and the new rows. The existing 19 areas' rows stay byte-identical. Update the "about" text.
4. **Acceptance (GA-B):**
   - `npm run db:reset` succeeds with about 406 listings. The 180 Northeast Georgia listings keep the same keys, prices, statuses and coordinates (compare a checksum before and after).
   - `public.spec` (Royston card text, the "Lake Hart"/"Flowery" autocomplete), `accounts.spec`, `dashboard.spec` and `foundation.spec` pass unchanged.
   - Run the full checks.

### GA-C1 — Database indexes and query changes

Measured on 65,000 synthetic statewide listings (Postgres 16, local, warm cache). Targets are for the same harness; allow 2–5× on a small Neon compute.

1. **`drizzle/0004_statewide_indexes.sql`, plus the matching `src/db/schema/listings.ts` changes:**
   - One partial btree per sort order, all `WHERE removed_at IS NULL AND transaction_type='sale' AND status IN ('active','coming_soon')`, matching `buildOrderBy` exactly:
     - recommended: `(is_featured desc, list_date desc nulls last, photo_count desc, id)`
     - newest: `(list_date desc nulls last, id)`
     - price: `(list_price, id)`
     - size: `(living_area_sqft desc nulls last, id)`
     - price per sqft: `((list_price::float/nullif(living_area_sqft,0)) nulls last, id)`
   - A partial btree `(latitude, longitude) INCLUDE (list_price)`.
   - `location_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', address, city, zip, neighborhood, mls_number)) STORED`, with a GIN index.
   - Trigram GIN indexes on `city` and `neighborhood`, and a btree on `mls_number`.
2. **`src/lib/search/query.ts`, plus `query.test.ts`:**
   - Bounds become `longitude BETWEEN w AND e AND latitude BETWEEN s AND n`, replacing the GiST `<@` box. Drop `listings_geo_idx` only if nothing else uses `point(...)`; grep first.
   - The location `q` matches `location_vector` (plus the city/neighborhood prefix and `mls_number`) instead of `search_vector`. Typing "Atlanta" must return homes in Atlanta, not every description that mentions it. `search_vector` stays for WP4's `kw`.
   - State normalization:
     - a bare "Georgia", "GA" or "Georgia, USA" means no location;
     - the suffix is anchored at the end, optionally followed by a ZIP: `/,?\s+(GA|Georgia)(?=\s*(\d{5})?\s*$)/i`.
     - New test cases: "Georgia" → "", "GA" → "", "The Georgia Club" unchanged, "Royston, GA 30662" → "Royston 30662".
3. **`scripts/perf/`** (dev-only; `npm run perf:seed` and `npm run perf:measure`): port the scratchpad harness (`scale/gen.cjs`, `measure.ts`). It builds `adams_perf` (65k listings) and prints EXPLAIN ANALYZE timings for the queries below. Drop the database at the end.
4. **Acceptance (GA-C1),** from `perf:measure`, before → target:

   | Query                               | Measured before         | Target                                             |
   | ----------------------------------- | ----------------------- | -------------------------------------------------- |
   | default /homes cards / count / pins | 97 / 45 / 68 ms         | ≤ 2 / ≤ 10 / ≤ 5 ms                                |
   | each sort order, page 1             | 50–100 ms               | ≤ 2 ms                                             |
   | page 50 / page 500                  | 89 / 225 ms             | ≤ 5 / ≤ 40 ms                                      |
   | statewide bounds page 1 / count     | 72–112 / 67 ms          | ≤ 2 / ≤ 10 ms                                      |
   | metro-Atlanta box page 1            | 22 ms                   | ≤ 2 ms                                             |
   | q=Atlanta count (and rows)          | 191–310 ms, 28,009 rows | ≤ 40 ms, equals the listings whose city is Atlanta |
   | getNewestListings                   | 63 ms                   | ≤ 2 ms                                             |

   Also: all existing search tests pass, and no e2e test relied on a description-only match (grep e2e for q= values). Run the full checks.

### GA-C2 — Sync, sitemap and caching

1. **Purge (`src/lib/mls/sync.ts`):**
   - Replace `notInArray(listingKey, activeKeys)` with one array parameter, `listing_key <> ALL($1::text[])`, which works past 65,534 keys.
   - Scope `fetchActiveKeys` (`reso/provider.ts`) to the statuses and close-date window the incremental sync imports, so sold mode survives a purge.
   - **Safety cap:** a purge that would remove more than 5% of live feed listings aborts, logs, and marks the run failed.
2. **Writes (`sync.ts`, `persist.ts`):**
   - Skip rows whose modification timestamp is unchanged.
   - Rewrite media and open houses only when their content changed (compare URL lists).
   - Batch each page's writes: one multi-row upsert, then media. `upsertListing` stays the single write path for other callers (the rule in CLAUDE.md).
3. **Runs:**
   - At the start of each run, mark `sync_runs` rows still `running` after more than `maxDuration` as failed.
   - The first statewide load runs from the CLI (`npm run mls:sync -- --full`) on a workstation or CI, never on Vercel.
   - After a successful cron run, `src/app/api/cron/sync/route.ts` calls `revalidateTag("listings", "max")`.
4. **Cron (`vercel.json`):**
   - If the owner approves Vercel Pro, change the incremental sync to `*/15 * * * *` and keep the purge as its own daily run.
   - Otherwise keep the daily schedule unchanged.
5. **Sitemap:**
   - Move listing URLs to `src/app/homes/sitemap.ts` with `generateSitemaps`. Chunks are about 10,000 URLs, keyset by id; in Next 16, `id` arrives as `Promise<string>`.
   - `src/app/sitemap.ts` keeps static pages and areas.
   - `robots.ts` lists every chunk.
6. **Caching:** new `src/lib/listings/cached.ts` wraps `getMarketStats`, `getPopularAreas`, `getFeaturedListings` and `getAreaSummaries` in `unstable_cache`. Use tag `listings` with a 900 s `revalidate` backstop, because a CLI sync can't revalidate tags.
   - The home page, the areas pages and the areas sitemap import from it.
   - Dashboard listing actions call `updateTag("listings")`.
7. **Acceptance (GA-C2):**
   - A unit test with a fake provider purges using 100,000 keys and succeeds.
   - A purge that would remove 10% aborts and records a failed run.
   - `sync-bench`, ported into `scripts/perf`:
     - an incremental run over 300 changed records takes under 5 s of database time locally;
     - an unchanged record causes 0 media writes;
     - the queries per listing on a page of 200 drop from about 6 to at most 1.
   - On `adams_perf`: each sitemap chunk has at most 10,000 URLs and is under 4 MB, and the URLs across all chunks add up to the live listing count (53,000).
   - A second home-page request issues none of the four stats queries (checked with a query counter in dev), down from about 280 ms of database time.
   - Run the full checks.

### GA-A — Config, copy, map default view

1. **`src/config/site.ts`:**
   - Add `coverage: { name: "Georgia", bounds: { west: -85.61, south: 30.35, east: -80.75, north: 35.01 } }`, documented as "What the listings cover: Georgia MLS IDX, statewide."
   - Keep `market` for the firm: `region: "Northeast Georgia"`, plus state, stateName, timeZone and counties, documented as "Copy about the firm uses this, never coverage."
   - Delete `market.name`, `center` and `zoom`; typecheck then flags each place that used them.
   - Reword the comments at :37, :46 and :57–61.
   - `featuredAreas`: `["Atlanta", "Savannah", "Athens", "Blue Ridge", "Lake Hartwell"]` (owner question 3).
2. **Listing-coverage copy (exact):**
   - `site.description`: "Homes, land, farms, lake and commercial property for sale across Georgia, with Adams Realty, Inc. in Royston. Listings from Georgia MLS, honest monthly costs, and no ads — ever." Re-read the line before editing; it must keep "no ads — ever".
   - `layout.tsx`: the root title becomes `${site.name} — Homes for sale in ${site.coverage.name}`.
   - `homes/page.tsx`: titles per mode are "Homes for sale in Georgia", "Homes for rent in Georgia" and "Recently sold homes in Georgia". This fixes the sold-mode title. The description is `Browse ${title with only its first letter lowercased} from ${site.mls.name}, with honest monthly cost estimates and no ads.`, which fixes the lowercased "northeast georgia" and drops "local agents".
   - `search-view.tsx:99`: `criteria.q ?? (criteria.bounds ? "this area" : site.coverage.name)`.
   - `(site)/page.tsx`:
     - :50 eyebrow: "All of Georgia"
     - :57–59 lead: "Homes, land, farms and lake property across Georgia, updated directly from Georgia MLS. Honest monthly costs. Agents who actually pick up the phone."
     - :189: "Towns and cities across Georgia"
     - :190: "From city neighborhoods and small-town main streets to the mountains, the lakes and the coast."
     - :160: "We never sell your details. One inquiry reaches one Adams Realty agent — not a bidding war of strangers."
   - `contact/page.tsx:32`: "Homes, land and farms for sale across Georgia."
   - `site-footer.tsx:79–80`: "Homes, land, farms and lake property across Georgia, with agents serving Northeast Georgia from our office in Royston. No ads, and we never sell your information." The column title "Towns" becomes "Places".
3. **Firm truth on homes outside the firm's area:**
   - New pure `src/lib/areas/firm-area.ts`: `isFirmArea(listing)` is true when `site.market.counties` includes the listing's county, or when `guideForLocation(neighborhood, city)` finds a guide. Unit-tested with Royston (true), Lake Lanier/Forsyth (true), Savannah (false) and a null county (false).
   - The no-agent box in `homes/[slug]/page.tsx` keeps today's copy for listings in the firm's area. Outside it, the heading is "Questions about this home?" and the body is "Adams Realty is based in Royston and works mainly in Northeast Georgia. Send a question and one of our agents will get back to you." (Final wording depends on owner question 1.)
   - `inquiries.ts:180`: "An Adams agent will be in touch soon."
   - `about/page.tsx:107`: "…or our office, which assigns one of our agents."
4. **Unchanged firm-identity copy:** about, sell, agents, contact metadata, contact-methods, the home page sell block and "Local agents, not call centers", Andrea Anderegg's bio and counties, and all 19 area guides with their `/areas` copy.
5. **`search-map.tsx`** (after DM): `initialBounds = bounds ?? pinsBounds(pins) ?? site.coverage.bounds`. Always fit bounds, with no center or zoom. Use padding 24 for the state fit and 56 for pins, as today.
6. **Tests:**
   - e2e:
     - `/homes` h1 reads "Homes for sale in Georgia";
     - the `?mode=sold` title contains "Recently sold";
     - every featured chip returns at least 1 result;
     - `/about` still contains "Northeast Georgia";
     - a Savannah listing shows "Questions about this home?" and a Royston listing shows today's box;
     - `/` and the footer still contain "no ads" and "never sell".
   - Unit: `src/config/coverage.test.ts` checks that every seed-sites point lies inside `site.coverage.bounds` and within 12 km of its area's center. `config.test.ts` (the guide bounding box) is unchanged.
7. **Docs:** say that listings cover all of Georgia, the firm serves Northeast Georgia, and the demo seed is statewide with Adams listings in Northeast Georgia. Files: CLAUDE.md:5 and :18, ARCHITECTURE.md:5 and :34–35, README.md:4 and :26, HANDOFF.md:13 and :30.
8. **Acceptance (GA-A):** everything above passes, then run the full checks.

### GA production cutover (after the branch ships; owner-gated)

1. The owner confirms the Georgia MLS feed terms and the hosting plan (owner questions 2 and 4).
2. Move Neon to a paid plan: the statewide data is about 0.65–0.75 GB, and the Free plan's limit is 0.5 GB.
3. Deploy GA-C first. Run the full load from the CLI, then widen `data_sources.config.filter` to statewide.
4. Deploy the GA-A copy **only once statewide listings are live**, so "across Georgia" is never false in production.
5. Existing Vercel preview databases don't reseed themselves: reset them by hand.

---

## Hand-offs to the work packages (edit docs/mobile-spec/workpackages.md in DM5 and GA-A)

- **WP2:**
  - Keep `<ThemeMenuButton>` in the wide header.
  - `mobile-menu.tsx` renders `<AppearanceControl variant="segmented">`.
  - F49's `theme-color-sync.tsx` must use `setChromeColor("#0f2a20")` while the hero is in view and `setChromeColor(null)` afterwards. Change the F49 acceptance from "#fbfaf7" to "the resolved canvas colour", tested under both color schemes.
  - Keep the `on-ink`/`surface`/`shade` classes.
  - The home hero chips come from `site.featuredAreas`.
- **WP3:**
  - Keep `installOverlays` on `style.load` and the theme `setStyle`, and keep "pins, else `site.coverage.bounds`" for the first fit.
  - Replace the capped 750 RSC pins with a cacheable map endpoint: grid clusters below about zoom 11 (measured 24 ms and 3 KB statewide) and pins when zoomed in.
  - Don't re-run the list query on every pan.
  - Keep new MapPin fields small.
- **WP4:**
  - The query contract is now BETWEEN bounds plus `location_vector`; `kw` uses `search_vector`; the county branch needs its own index.
  - Cap pagination at 40 pages, and evaluate `nextOpenHouse` after the limit.
  - Move suggestions onto a `places` materialized view refreshed after each sync (about 70 ms → under 1 ms per keystroke).
  - `inGeorgia` may prefilter with `site.coverage.bounds`.
- **WP5:** the tour sheet reuses `isFirmArea` and the out-of-area copy.
- **WP1:**
  - The manifest's `theme_color` and `background_color` stay #fbfaf7, because the manifest can't vary by scheme.
  - Decide `appleWebApp.statusBarStyle` there.
  - Manifest icons are unaffected.

## Risks to watch

- React 19 must tolerate the meta tag the script inserts into `<head>`. The "no hydration warning" and "first theme-color meta" e2e tests prove it.
- Browsers from before 2023 (no oklab `color-mix`) show translucent tokens in their light values. This is accepted.
- A custom map style with a different sprite forces a full style rebuild. `installOverlays`' guard re-adds everything.
- Once the real feed is statewide, the unfiltered map shows the first 750 pins until WP3's clusters land. The demo (about 406 listings) stays under the cap.
- The timings come from synthetic data on a fast desktop. Re-run `perf:measure` against the real feed after cutover.
