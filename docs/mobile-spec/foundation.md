### GATE G0: task #10 in the working tree (the lead makes no file edits for this gate)

Hard gate before the foundation starts. #10 is unfinished, not just uncommitted:

- The task list shows it in_progress, with area guides and lead detail outstanding.
- The tree has 20 modified paths, including site-footer.tsx, dashboard-nav.tsx, listing-form.tsx, lead-controls.tsx, dashboard/leads/page.tsx, dashboard/listings/page.tsx, lib/dashboard/queries.ts, the account page and forms, auth.ts, email.ts, inquiries.ts and vercel.json.
- About 30 paths are untracked: src/lib/alerts/*; src/app/(site)/{about,accessibility,alerts,areas,contact,fair-housing,privacy,terms}; dashboard/{agents,profile,leads/[id],leads/export}; components/{areas,content}; and several dashboard components.

Rules:

1. #10's owner finishes and commits all of #10. The lead never commits someone else's in-progress work.
2. The lead verifies that `git status --porcelain` is empty, that `npm run lint && npm run typecheck && npm test` passes, and that the existing e2e suites pass. The lead records the HEAD sha as the base of branch mobile/foundation.
3. No wave-1 package adds a migration (the push table moved to wave 2), so drizzle/meta/_journal.json stays at 0002 plus whatever #10 adds.

Fallback, only if #10 cannot land at all:

- The foundation may start, because none of its files are #10 paths.
- All of WP6 moves to wave 2.
- WP2's #10-overlapping files (site-footer.tsx, the account page and forms, (site)/page.tsx, content and area pages) wait until #10 is committed.
- F04 and F05 are already wave 2.
- Nothing else overlaps.

### scripts/mobile-worktree.sh (new) and the per-package isolation rules

Every package runs isolated. A half-edited file in one package must never break another package's typecheck or e2e run, and one package's db:reset must never wipe another's data.

`scripts/mobile-worktree.sh <N>` does the following:

1. `git worktree add ../adams-wp<N> -b mobile/wp<N> mobile/integration`.
2. `npm ci`.
3. `createdb -h localhost -U adams adams_wp<N>`. The adams role has CREATEDB, and pg_trgm is a trusted extension.
4. Writes a git-ignored `.env` with DATABASE_URL=postgres://adams:adams@localhost:5432/adams_wp<N> and NEXT_PUBLIC_SITE_URL=http://localhost:310<N>. dotenv in drizzle.config.ts and scripts/seed.ts, and Next itself, all read `.env`, and better-auth's baseURL must match the port.
5. `npm run db:reset`.
6. Starts `npx next dev -p 310<N>` in the background. Next 16 writes dev output to .next/dev and locks per project directory, so separate worktrees run side by side.

Each package also runs Playwright against its own server: E2E_BASE_URL=http://localhost:310<N> and PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium. Its production PWA run uses `next build && next start -p 320<N>` in its own worktree.

The shared :3000 dev server and the adams_realty database are never used by packages.

Integration:

- The lead merges packages into mobile/integration one at a time. Suggested order: WP2, WP3, WP4, WP5, WP1, WP6; take whichever is green first, but only one at a time.
- After each merge, the lead runs the full suite and the quality sweep in the lead's own worktree (port 3100, database adams_int). Other packages then rebase.
- Each package merges twice: P0 first, then P1. P1 work starts only after that package's P0 merge is green on integration.

### Ownership after the foundation: lead-owned files and change requests

These files become lead-owned once the foundation lands, and no package edits them:

- src/app/layout.tsx and src/app/globals.css;
- src/components/ui/{dialog,popover,form,button,section,toast}.tsx;
- src/components/listings/save-button.tsx and src/components/listings/record-view.tsx;
- src/components/search/use-search-nav.ts;
- src/lib/format.ts, format.test.ts, mortgage.ts, mortgage.test.ts, local-store.ts, use-media-query.ts, idle.ts, deeplinks.ts, deeplinks.test.ts;
- src/lib/search/recent.ts and recent.test.ts;
- src/lib/pwa/protocol.ts and src/lib/pwa/client.ts;
- src/lib/listings/card.ts;
- src/app/dev/primitives/page.tsx;
- playwright.config.ts;
- e2e/mobile/helpers.ts, axe-allowlist.ts, foundation.spec.ts, sweep.spec.ts, head-to-head.spec.ts;
- package.json and package-lock.json, vercel.json, ARCHITECTURE.md, scripts/mobile-worktree.sh.

Change requests:

- Packages first use Tailwind arbitrary values and variants inside their own files.
- If a shared change is unavoidable, the package sends the lead a patch and a reason. The lead lands it on mobile/integration the same session, and every package rebases.

Hand-offs: the foundation also makes small edits to files that are then owned by exactly one package:

- site-header.tsx, saved-homes-provider.tsx and tab-bar.tsx go to WP2;
- search-view.tsx goes to WP3;
- filter-bar.tsx and params.ts/params.test.ts go to WP4;
- homes/[slug]/page.tsx goes to WP5;
- pwa-runtime.tsx and install-entry.tsx go to WP1.

Owners must keep the APIs the foundation adds to those files. For example, WP2 keeps the provider's count and setLocal.

### src/app/globals.css

(a) Contrast.

- --color-faint: #98a19c → #68716d. It was 2.54:1 and is used about 52 times, including the card's 11px 'Listing by' line. It is now 4.82:1 on canvas, 5.03 on surface, 4.50 on sunken and 4.55 on brand-50.
- --color-brass-500: #b3843f → #8a6a2f. It was 3.20:1 and is used almost only for eyebrow text. It is now 4.81 on canvas and 5.02 on surface.
- brass-400 stays for dark backgrounds.

(b) Variables.

- :root sets --header-h:4rem, --tabbar-h:3.5rem, --top-chrome-h:var(--header-h), --bottom-chrome-h:0px and --bottom-overlay-h:0px.
- --sai-top, --sai-right, --sai-bottom and --sai-left default to env(safe-area-inset-*, 0px).
- `@media (pointer:coarse) and (max-height:500px){:root{--tabbar-h:3rem}}`.

(c) Utilities. These add the inset: pt-safe, pt-safe-_, pb-safe, pb-safe-_ and bottom-safe-_. These use the inset alone: pl-safe and pr-safe. These use max(--spacing(N), inset): pl-safe-_ and pr-safe-_. All utilities read the --sai-_ variables, so tests can simulate a notch.

(d) Variants.

- `@custom-variant phone { @media (max-width:767.98px), (pointer:coarse) and (max-height:500px) { @slot } }`
- `@custom-variant wide { @media (min-width:768px) and (min-height:501px), (min-width:768px) and (pointer:fine) { @slot } }`
- standalone and not-standalone (display-mode).
- Rule: app-shell decisions use phone: and wide:, sizing keeps sm/md/lg, and touch sizing uses the built-in pointer-coarse:.

(e) Chrome markers, inside the phone query.

- `body:has([data-own-chrome~=top]){--top-chrome-h:0px}` and `body:has([data-own-chrome~=top]) [data-site-header]{display:none}`.
- `body:has([data-own-chrome~=bottom]) [data-tabbar]{display:none}`.
- `body:has([data-tabbar]):not(:has([data-own-chrome~=bottom])){--bottom-chrome-h:calc(var(--tabbar-h) + var(--sai-bottom)); --bottom-overlay-h:same}`.
- Inside max-width:1023.98px, the bars [data-bottom-bar=action] and [data-bottom-bar=contact] reserve 4.5rem plus the inset, and [data-bottom-bar=staff] reserves 3.5rem plus the inset. --bottom-overlay-h counts only bars that are :not([data-state=hidden]).
- `body:not(:has([data-app-shell])) #main{padding-bottom:var(--bottom-chrome-h)}`.
- `html:has([data-app-shell]){overscroll-behavior:none}`.

(f) Keyboard, inside the phone query. `body:has(:is(input:not([type=checkbox],[type=radio],[type=range],[type=button],[type=submit],[type=reset],[type=file],[type=color],[type=image]),textarea,[contenteditable=''],[contenteditable=true]):focus)` hides `:is([data-tabbar],[data-hide-on-keyboard])` and sets --bottom-overlay-h:0px. Checkboxes, radios and selects no longer hide the bar.

(g) Full-screen search, inside the phone query.

- `body:has([data-search-fullscreen]) :is([data-site-header],[data-tabbar],[data-bottom-bar]){display:none!important}`.
- `html:has([data-search-fullscreen]){overflow:hidden}`.
- A safety net, `body :has([data-search-fullscreen]){transform:none!important;filter:none!important;backdrop-filter:none!important;perspective:none!important;contain:none!important;container-type:normal!important;will-change:auto!important;isolation:auto!important;z-index:auto!important;clip-path:none!important;mask:none!important}`, so no ancestor can become the fixed panel's containing block or trap its z-index. Otherwise the home hero is `relative isolate` and sits under the z-50 header, and the /homes overlay sits under the z-30 sheet.

(h) Other rules.

- `html:has(dialog[open]){overflow:hidden}`.
- `-webkit-tap-highlight-color:transparent`.
- touch-action:manipulation on a, button, [role=button], label and summary.
- A prefers-reduced-motion block.
- The keyframes sheet-up and --animate-sheet-up.
- MapLibre control margins that use --sai-*.
- A z-scale comment: map overlays 10/20, sheet 30, bottom bars 40, header 50, full-screen search 60, toasts 70, dialogs in the top layer.

### src/app/layout.tsx

metadata gains:

- appleWebApp {capable:true, title:'Adams Realty', statusBarStyle:'default'};
- formatDetection {telephone:false};
- other {'apple-mobile-web-app-capable':'yes'}.

viewport becomes {themeColor:'#fbfaf7', viewportFit:'cover', interactiveWidget:'resizes-content'}. The Viewport type supports interactiveWidget.

HeaderUser gains id. After #main, inside SavedHomesProvider, the layout mounts <TabBar user={user} />, <Toaster /> and <PwaRuntime userId={user?.id ?? null} />.

The header and tab bar are always rendered, and their visibility is CSS-only. Lead-owned afterwards.

### src/components/layout/site-header.tsx

Changes:

- Add data-site-header to the root.
- Add id to HeaderUser.
- Swap px-* for pl-safe-4 pr-safe-4 (sm 6, lg 8) on the inner row, so landscape notches never cover the logo or the menu.

There is deliberately no route-based hiding. The draft's pathname rule would leave phones with no navigation before WP2–WP5 merged, and would hide chrome on the /homes/does-not-exist 404.

WP2 owns the file afterwards.

### src/components/ui/section.tsx

Container: 'px-4 sm:px-6 lg:px-8' becomes 'pl-safe-4 pr-safe-4 sm:pl-safe-6 sm:pr-safe-6 lg:pl-safe-8 lg:pr-safe-8'. Portrait is identical, and in landscape the content clears the notch under viewportFit cover. Lead-owned.

### src/components/ui/form.tsx

Control class: text-sm becomes 'text-sm pointer-coarse:text-base', giving 16px on every touch device, including landscape iPhones and iPads.

The checkbox label adds 'pointer-coarse:min-h-11 pointer-coarse:py-2', and the checkbox itself is 20px on coarse pointers.

The APIs and the rendering on fine pointers are unchanged. Lead-owned.

### src/components/ui/button.tsx

Size classes:

- sm: 'h-8 pointer-coarse:h-11';
- md: 'h-10 pointer-coarse:h-11';
- lg: unchanged (h-12);
- icon: 'size-10 pointer-coarse:size-11'.

Desktop with a fine pointer is unchanged. Lead-owned.

### src/components/ui/dialog.tsx

The native <dialog> is kept, and behavior in the wide variant is unchanged. Additions:

1. Prop mobile?: 'sheet' | 'fullscreen' | 'center' (default 'sheet').

- phone:sheet is an inset-x-0 bottom-[var(--kb-inset,0px)] full-width sheet with rounded top corners and max-h-[calc(100dvh-var(--kb-inset,0px)-var(--sai-top)-8px)]. It has a grab handle in a 24px touch-none header zone.
- fullscreen is inset-0, h-dvh, pt-safe.

2. Swipe down on the handle or header closes the dialog (Pointer Events, more than 96px or more than 0.5px/ms). The close button is size-11, and the body and footer get pb-safe.

3. Keyboard. While the dialog is open, visualViewport resize and scroll events set --kb-inset to max(0, innerHeight − vv.height − vv.offsetTop). A focusin handler scrolls the target into view with {block:'nearest'}.

4. History. Prop closeOnBack?: boolean.

- On open it calls history.pushState({...history.state, __dialog:id}, ''), which keeps Next's internal state keys.
- popstate closes the dialog.
- requestClose() (X, scrim, Escape via the cancel event, swipe) pops only when our entry is on top, and returns a Promise that resolves after popstate.
- close({viaNavigation:true}) closes without popping. Use it only when the caller has already replaced that entry.
- navigateFromDialog(href, {replace?}) waits for history.back() and popstate, then calls router.push or router.replace. It is used by filter apply, menu links and More-sheet links, and it removes the race between replace and back.
- Export useDialogHistory(open, onClose) for custom dialogs (the lightbox) and useDialogControls() for children.

5. It renders a <div data-toast-slot> and registers itself in the open-dialog stack in toast.tsx.

6. Optional initialFocusRef.

Lead-owned.

### src/components/ui/popover.tsx

Add triggerClassName and unstyled props. When fixedOnMobile is set and the variant is phone (below lg), render a fixed inset-0 bg-ink/30 scrim that closes the popover on pointerdown with preventDefault, so the dismissing tap never reaches the page. The bottom panel gets pb-safe. The existing API is unchanged. Lead-owned.

### src/components/ui/toast.tsx (new)

A module store with toast(message, {action?: {label, onClick}, tone?: 'default'|'error', duration=4000}) and <Toaster />. One toast is visible at a time. The action button is 44px. It uses role='status' and deliberately no aria-live attribute, because e2e expects exactly one [aria-live=polite] on /homes.

Placement:

- If a modal dialog is open (from the stack Dialog registers), the toast portals into that dialog's [data-toast-slot], absolutely positioned 12px above the dialog footer. A toast outside a modal dialog would be inert, which would make Undo unclickable.
- Otherwise it is fixed and centered at bottom calc(var(--bottom-overlay-h) + 12px), z-70, with pl-safe-4 and pr-safe-4.

Lead-owned.

### src/components/listings/save-button.tsx

Variants:

- overlay: 'size-10 pointer-coarse:size-11' (on photos);
- outline: 'h-10 pointer-coarse:h-11' (with a label);
- new plain: a size-11 round button with a transparent background, no blur or shadow, and a 20px heart. It is for the action bar, the listing top bar, saved rows and strip cards.

Add export const SaveIntercept = createContext<((listingId: string) => void) | null>(null). When the heart is pressed while saved and an interceptor is present, SaveButton calls the interceptor instead of toggle; /saved uses this for pending removal.

The aria-label and aria-pressed are unchanged. Lead-owned.

### src/components/listings/saved-homes-provider.tsx

Add count (ids.size) and setLocal(listingId, saved) to the context value. setLocal is a client-only override used by pending removal, and the next server reconcile wins. Nothing else changes. WP2 owns the file afterwards and must keep both APIs.

### src/lib/format.ts and src/lib/format.test.ts

Add these helpers, with tests:

- formatMonthly(n) → '$3,412/mo';
- formatMonthlyShort(n) → '$3.4K/mo';
- formatRelativeShort(d, now) → '6m', '3h', '3d', 'Oct 2';
- formatChangeChip({type, price, previousPrice, toStatus, occurredAt}, now) → 'Price cut $25K · 3d', 'Price up $10K · 1d', 'Now pending', 'Sold', 'Back on market';
- freshness(lastSyncedAt, now) → {label: 'Updated 12 min ago', stale}, with STALE_FEED_MS = 2h and null treated as stale.

Lead-owned.

### src/lib/mortgage.ts (exists) and src/lib/mortgage.test.ts (new)

Add to the existing module:

- monthlyCostModel(finance = site.finance) → {piPerDollar, insuranceRateMonthly, taxFallbackRateMonthly, pmiRateMonthly};
- quickMonthlyCost({price, annualTax, hoaFee, hoaFrequency}, model?), reusing monthlyHoaAmount.

The existing mortgage tests stay in src/lib/format.test.ts. The new file checks quickMonthlyCost against estimateMonthlyCost to within $1 for 3 fixtures. The wave-2 SQL maxMonthly will use the same coefficients. Lead-owned.

### src/lib/listings/card.ts

Add taxAnnualAmount, hoaFee and hoaFrequency to cardColumns (listOfficeName is already there). The change is additive. Lead-owned.

### src/lib/local-store.ts, src/lib/use-media-query.ts, src/lib/idle.ts (new)

local-store:

- readJSON, writeJSON and remove, with every storage access in try/catch;
- subscribe through the storage event plus an in-tab emitter;
- useLocalValue(key, fallback), built on useSyncExternalStore with the fallback as the server snapshot;
- the STORE_KEYS registry: ar:recentSearches, ar:lastSearch, ar:recentlyViewed, ar:searchAsMove, ar:installDismissedAt, ar:visitDays, ar:uid.

use-media-query:

- useMediaQuery(query, serverDefault=false);
- export const PHONE_QUERY = '(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)';
- useIsPhone();
- a test that reads globals.css and asserts the phone variant uses the identical string.

idle: whenIdle(cb, {timeout}). It uses requestIdleCallback when present, and otherwise requestAnimationFrame followed by setTimeout(cb, 0), because iOS Safari lacks rIC. It returns a cancel function.

All lead-owned.

### src/lib/search/recent.ts and src/lib/search/recent.test.ts (new)

Pure functions with injectable storage and cookie writer:

- recordSearch(criteria) stores {href, label: describeCriteria, at}, deduplicated by href with a maximum of 8. It sets lastSearch and writes the cookie ar_last_search (serialized query including view, path=/, max-age 90d, SameSite=Lax, 1500 chars or fewer).
- setLastSearchView(view) updates the stored href and cookie.
- readRecentSearches() and lastSearchHref().
- recordView({slug, address, price, photo, beds, baths, listOfficeName, transactionType, status}) adds viewedAt, with a maximum of 20.
- readRecentlyViewed() and clearRecents().

Tests use Map-backed storage. Lead-owned.

### src/components/listings/record-view.tsx (new) and src/app/homes/[slug]/page.tsx (one-line mount)

RecordView is a client component that calls recordView(snapshot) on mount. The foundation mounts <RecordView snapshot={…including listOfficeName} /> in the listing page. Together with the recordSearch effect in search-view.tsx, this removes the hidden dependencies that WP2's 'Continue your search', 'Recently viewed' and Search-tab ACs and WP4's 'Recent searches' AC had on WP3 and WP5. WP5 owns the page afterwards and must keep the mount.

### src/lib/deeplinks.ts and src/lib/deeplinks.test.ts (new)

Functions:

- toE164(phone) for US numbers;
- telHref(phone);
- smsHref(phone, body), using the '?&body=' form;
- mailtoHref(email, {subject, body});
- directionsHrefs({lat, lng, address, hideAddress}) → {apple, google, streetView}, or null when the address is hidden;
- isApplePlatform(ua).

Unit-tested. Lead-owned.

### src/lib/pwa/protocol.ts and src/lib/pwa/client.ts (new)

protocol.ts has no DOM access and is importable by the SW. It holds the cache names (static-v1, pages, images), the message types (CACHE_PAGES, CLEAR_USER_DATA), and the PAGE_ALLOW and NEVER regex lists.

client.ts:

- unsubscribePush() calls `(await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription())?.unsubscribe()`. It needs no session. The server row gets a 410 on the next send in wave 2 and is then deleted.
- clearUserCaches() deletes the pages and images caches, posts CLEAR_USER_DATA, calls clearRecents() and swallows errors.
- prepareSignOut() awaits unsubscribePush(), then clearUserCaches(), with a 1500ms cap. WP2 awaits it before authClient.signOut(), and WP1 runs the same sequence on a uid-marker mismatch.
- warmPages(urls) posts CACHE_PAGES to the controller, or does nothing without one.

Lead-owned.

### src/components/layout/tab-bar.tsx, src/components/pwa/pwa-runtime.tsx, src/components/pwa/install-entry.tsx (new stubs)

Typed stubs that return null, with final signatures: TabBar({user: HeaderUser}), PwaRuntime({userId: string | null}) and InstallEntry({className?}). WP2 owns tab-bar.tsx; WP1 owns the other two.

### src/lib/search/params.ts and src/lib/search/params.test.ts

Move SORT_LABELS out of search-view.tsx into params.ts as an export. Add sortLabel(sort, mode), which returns 'Recently sold' for newest in sold mode, and SORT_HELP = 'No paid placement. Recommended shows Adams-featured homes first, then newest.' Add tests. There is no poly param; it moves to wave 2 with draw. WP4 owns both files afterwards.

### src/components/search/use-search-nav.ts

Changes:

- update() keeps the current view param, read from window.location.search.
- Export a pure buildSearchHref(criteria, patch, view?), which resets to page 1.
- Add setView(view), which uses window.history.replaceState(null, '', url). Next 16 syncs native history with the router, and this must not trigger an RSC request.

WP3 (sheet and restoration) and WP4 (filters apply through navigateFromDialog) both use it. Lead-owned.

### src/components/search/search-view.tsx

Changes:

- Import SORT_LABELS and sortLabel from params.ts.
- Add useEffect(() => recordSearch(criteria), [serialized criteria]).
- Render <SaveSearchButton criteria signedIn /> in the existing results header next to Sort, so there is exactly one Save search button at every size from day one.

WP3 owns the file afterwards.

### src/components/search/filter-bar.tsx

Delete the SaveSearchButton import and render, which moves to the results header. Nothing else changes. WP4 owns the file afterwards and never renders SaveSearchButton.

### playwright.config.ts

Projects:

- desktop: testIgnore /mobile\//.
- mobile: unchanged (Pixel 7, public.spec.ts).
- pixel7: {...devices['Pixel 7']}.
- iphone13: {...devices['iPhone 13'], browserName:'chromium', defaultBrowserType:'chromium'}.
- iphone13-landscape: viewport 844x390, isMobile, hasTouch, deviceScaleFactor 3, iPhone UA, chromium.
- ipad-mini: viewport 744x1133, isMobile, hasTouch, deviceScaleFactor 2, iPad UA, chromium.

pixel7 and iphone13 run testMatch /mobile\/.*\.spec\.ts/. iphone13-landscape and ipad-mini run /mobile\/(sweep|._landscape)._\.spec\.ts/ plus any test tagged @landscape (grep).

baseURL comes from E2E_BASE_URL. webServer uses {command: `npx next dev -p ${PORT ?? 3000}`, url: baseURL, reuseExistingServer: true}.

Only Chromium is used (/opt/pw-browsers/chromium). A foundation test asserts that matchMedia('(pointer: coarse)') matches on touch projects; if Chromium does not report it, the fixture enables touch emulation over CDP.

### e2e/mobile/helpers.ts, e2e/mobile/axe-allowlist.ts, e2e/mobile/foundation.spec.ts (new), plus the @axe-core/playwright devDependency in package.json and package-lock.json

helpers.ts:

- expectNoHorizontalOverflow;
- expectControlsAtLeast16px (coarse projects);
- expectTapTargets(selector, 44, allowlist?);
- touchTap, touchDrag and pinch, via CDP Input.dispatchTouchEvent;
- simulateNotch(page, {left, right, bottom}), which overrides --sai-*;
- simulateKeyboard(page, fraction), which stubs visualViewport and dispatches resize;
- expectNoDocOrRscRequest(page, fn);
- historyLength(page);
- countTaps(page), a tap-counter wrapper for head-to-head flows;
- withDb(fn), a pg Client from DATABASE_URL for test-only setup and teardown such as removed_at and last_synced_at;
- expectNoSeriousAxe(page), which applies axe-allowlist entries (rule, selector, owner package);
- signIn, re-exported from ../helpers.

The axe dependency is dev-only. All of these files are lead-owned.

### src/app/dev/primitives/page.tsx (new)

A dev-only test page that calls notFound() when NODE_ENV === 'production' and sets robots noindex. It renders:

- a closeOnBack sheet;
- a fullscreen dialog with a navigateFromDialog link;
- a toast with an action inside an open dialog;
- a text input inside a sheet;
- a popover with a scrim over a link;
- all SaveButton variants.

foundation.spec.ts drives it. Lead-owned.

### ARCHITECTURE.md

Add a 'Mobile & PWA' section covering these contracts:

- the phone and wide variants, and PHONE_QUERY;
- the chrome markers (data-own-chrome, data-bottom-bar, data-state) and the two bottom variables;
- the full-screen search attribute and the ancestor rule;
- exactly one [aria-live=polite] on /homes;
- exactly one Save search button;
- at most one #c-name;
- the first main p.tabular on a listing is the price;
- preview-strip items are not article elements;
- the z-scale;
- the local-store keys and the ar_last_search cookie;
- the SW never-cache list and the per-user purge;
- pending removal;
- the lead-owned files and the change-request path;
- the worktree workflow.

### Foundation exit criteria (e2e/mobile/foundation.spec.ts)

Before any package starts, all of these must pass:

1. lint, typecheck and unit tests; the existing desktop and mobile e2e suites, unchanged.
2. On /dev/primitives (pixel7 and iphone13):

- page.goBack() with the sheet open closes it, keeps the URL and makes no RSC request.
- Clicking the navigateFromDialog link and then a single goBack() returns to /dev/primitives, and history.length grows by 1.
- The toast action inside the open dialog is clickable and fires.
- With simulateKeyboard(0.55), the focused input in the sheet is fully visible and --kb-inset is greater than 0.
- A scrim tap on the popover does not navigate.
- SaveButton plain and overlay are at least 44x44 on coarse pointers.

3. The meta viewport contains viewport-fit=cover and interactive-widget=resizes-content.
4. On /, /homes, a listing and /sign-in there are 0 color-contrast violations. Any other pre-existing serious or critical axe findings are listed in axe-allowlist.ts with an owner.
5. The header and the (stub-null) tab bar render on every route, including the /homes/does-not-exist 404.
6. At 1440x900, screenshots of /, /homes, a listing and /saved differ from the baseline only in the faint and brass colors.
