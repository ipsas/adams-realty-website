## Every package: dark mode

Dark mode landed before the packages (docs/plans/dark-mode-and-georgia.md, "DM"). Each package inherits it, and these rules are part of every package's acceptance:

- New UI follows the theme contract in docs/mobile-contracts.md ("Themes"): theme tokens, `shade` for overlays on photos and maps, `bg-surface` for chips on photos, `text-on-ink` on a solid `bg-ink`, `bg-primary` for the primary fill, no hex colours in class names. `src/lib/theme-guard.test.ts` stays green.
- Every page a package adds or redesigns joins the dark axe matrix in `e2e/theme-suite.ts` (`DARK_AXE_PAGES` and `DARK_AXE_PHONE_PAGES`, with the role that sees it): with Dark forced, `expectNoSeriousAxe` reports 0 color-contrast violations (never allowlisted) and no un-allowlisted serious or critical finding, on desktop, pixel7 and iphone13.
- A package's own axe checks (the sweeps below) run in light and again with Dark forced.

## Every package: all of Georgia

GA-A (docs/plans/dark-mode-and-georgia.md; ARCHITECTURE.md "Coverage and the firm's area") also landed first. Listings cover all of Georgia; the firm is Northeast Georgia. Every package keeps these:

- Copy about listings uses `site.coverage`; copy about the firm (our agents, tours, the office) uses `site.market`. No town list in code: towns come from `getCachedTopCities` / `getCachedPlacesIndex`.
- Tours, "see it with a local expert" and "our agents know this home" appear only where `offersTours(listing)` is true (the firm's own listings and `isFirmArea`, county-scoped). Elsewhere a listing offers "Ask a question", answered by the office. The home page never says "monthly cost(s)" (owner decision); listing pages keep their estimate.
- `e2e/georgia.spec.ts` and `e2e/mobile/georgia-map.spec.ts` pass.
- `e2e/theme.spec.ts`, `e2e/mobile/theme.spec.ts` and `e2e/theme-light-regression.spec.ts` pass. A package that changes a light page on purpose updates that page's baseline in the same commit and says so.

## WP1 Installable app and saved homes that work offline (PWA shell, SW, install coach, /saved redesign, notes)

features: ['F01', 'F02', 'F03', 'F30', 'F31', 'F32', 'F47', 'F48', 'F35', 'F36']
owns: ['src/components/pwa/pwa-runtime.tsx', 'src/components/pwa/install-entry.tsx', 'next.config.ts', 'src/app/(site)/saved/page.tsx', 'src/components/account/saved-search-row.tsx', 'src/server/actions/saved.ts', 'src/lib/listings/queries.ts']
new: ['src/app/manifest.ts', 'src/app/apple-icon.tsx', 'src/app/icons/[name]/route.ts', 'src/components/pwa/brand-mark.tsx', 'src/sw/sw.ts', 'src/lib/pwa/sw-assets.ts', 'src/lib/pwa/sw-assets.test.ts', 'src/components/pwa/service-worker.tsx', 'src/components/pwa/install-store.ts', 'src/components/pwa/install-store.test.ts', 'src/components/pwa/install-sheet.tsx', 'src/components/pwa/offline-banner.tsx', 'src/lib/pwa/use-online-status.ts', 'src/app/offline/page.tsx', 'src/components/saved/saved-tabs.tsx', 'src/components/saved/saved-homes-list.tsx', 'src/components/saved/saved-home-row.tsx', 'src/components/saved/use-pending-removal.ts', 'src/components/saved/note-sheet.tsx', 'src/components/saved/refresh-button.tsx', 'src/app/(site)/saved/loading.tsx', 'e2e/mobile/pwa.spec.ts', 'e2e/mobile/pwa-offline.spec.ts', 'e2e/mobile/saved.spec.ts']

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 1` (port 3101, database adams_wp1). Read these first: node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md; 03-file-conventions/01-metadata/manifest.md and app-icons.md; 04-functions/image-response.md; 02-guides/offline-support.md.
- src/components/pwa/brand-mark.tsx: render the icon.svg geometry as JSX (rect #1a4c39, a white 'A', a brass bar) in four variants: any; maskable (full-bleed background, glyph at 60% width); monochrome; apple (opaque).
- Icon routes:
- src/app/icons/[name]/route.ts: dynamicParams=false; generateStaticParams for icon-192.png, icon-512.png, maskable-512.png and monochrome-96.png; each returns an ImageResponse at its declared size with Cache-Control 'public, max-age=86400'.
- src/app/apple-icon.tsx: 180x180, opaque.
- src/app/manifest.ts: as F01.
- src/sw/sw.ts core:
- Start with `/// <reference lib="webworker" />`. CACHE_ENABLED = NODE_ENV === 'production'. Constants come from src/lib/pwa/protocol.ts.
- install: precache /offline with credentials 'omit', then skipWaiting.
- activate: navigationPreload.enable() and clients.claim(); no bulk deletes.
- fetch: the F02 rules, with cacheFirst plus LRU trimming, networkFirstPage with preloadResponse, and staleWhileRevalidate for icons and the manifest.
- message: CACHE_PAGES (same-origin, PAGE_ALLOW, at most 50, credentials 'include') and CLEAR_USER_DATA.
- The push and notificationclick handlers stay wave 2.
- src/lib/pwa/sw-assets.ts, pure and unit-tested:
- extractAssets(html) returns the /_next/static script, stylesheet and modulepreload URLs, plus the first preloaded or priority image candidate at about 828w.
- The SW calls it after storing any HTML page and caches the results (static and images caches).

Offline launch:

- /homes search navigations are cached under their full URL, keeping only the 3 most recent.
- An offline /homes?… navigation serves the exact entry, else the most recent search, else /offline.
- src/app/offline/page.tsx: static, robots noindex, no DB access. It renders the heading 'You're offline' and a static explanation. An inline <script> (dangerouslySetInnerHTML, no React hydration) lists caches.open('pages') entries by the <title> in each cached HTML: saved and viewed listings first, then 'Your last search'. It has an empty state.
- Runtime:
- src/components/pwa/service-worker.tsx: register via whenIdle() with {scope:'/', updateViaCache:'none'} and call reg.update() on visibilitychange. Fallback: public/sw.js built from the same source, plus a no-cache header for /sw.js in next.config.ts. Document which path shipped.
- src/components/pwa/pwa-runtime.tsx: mount ServiceWorker, OfflineBanner and (P1) InstallCoach. Hash userId with crypto.subtle SHA-256 and compare it with ar:uid; on change, run await unsubscribePush(), then await clearUserCaches(), then store the new marker. Record visit days. Call navigator.storage.persist() after appinstalled or the first save.
- src/lib/pwa/use-online-status.ts (useSyncExternalStore) and src/components/pwa/offline-banner.tsx: a fixed pill at top calc(var(--sai-top) + 8px), with role='status' and no aria-live. It reads 'You're offline — showing saved copies'.
- src/lib/listings/queries.ts getSavedListings, additive changes only (existing callers keep working):
- also select savedListings.note and savedListings.createdAt as savedAt;
- add a correlated latest-change subquery: the latest listing_event after savedAt, with type, price, previousPrice, toStatus and occurredAt;
- use explicit "listings"."id" references, per CLAUDE.md.
- Saved page structure:
- src/app/(site)/saved/page.tsx: read searchParams.tab. <SavedTabs> renders two 44px links with aria-current ('Homes (n)' and 'Searches (n)', ?tab=searches).
- The Homes tab renders <SavedHomesList>.
- The Searches tab renders the SavedSearchRow list and its empty state.
- Add loading.tsx.
- P1: <RefreshButton> (F48).
- Saved home list and rows:
- src/components/saved/saved-homes-list.tsx:
  - a sort select (16px on coarse pointers);
  - SavedHomeRow items in the phone variant, and the ListingCard grid in the wide variant;
  - the 'No longer available (n)' group with Remove and Clear all;
  - warmPages(first 50 '/homes/<slug>') on mount;
  - the whole list wrapped in <SaveIntercept.Provider value={pendingRemove}>.
- src/components/saved/use-pending-removal.ts: calls setLocal(id, false), marks the item pending, and shows toast('Removed from saved', {action: Undo, duration: 5000}). It commits removeSaved(id) when the timer expires, on unmount, or on pagehide (fire and forget). Undo cancels the timer and calls setLocal(id, true), with no server call.
- src/components/saved/saved-home-row.tsx: see F30. It is at most 140px tall, is not an article element, uses a plain SaveButton, shows the 'Listing by' line and a change chip via formatChangeChip, and shows 'est. $X/mo' via quickMonthlyCost.
- src/server/actions/saved.ts:
- Add removeSaved(listingId): an idempotent delete scoped to the actor, then revalidatePath('/saved').
- Add clearUnavailableSaved().
- P1: add setSavedNote(listingId, note), which trims to 500 characters, validates with zod and updates only the actor's own row; a missing row returns {ok:false}.
- All use getActor with can.saveListing and return typed results.
- Keep the signatures of toggleSavedListing, saveSearch, updateSavedSearchFrequency and deleteSavedSearch.
- src/components/account/saved-search-row.tsx: grid layout in the phone variant.
- The select is full width with 'h-11 text-sm pointer-coarse:text-base', and the helper reads 'Instant alerts are checked every hour.'
- Delete is size-11.
- Await actions. Success shows toast('Alerts: Daily'); failure resets the select and shows an error toast.
- Delete uses the same pending-removal hook, so the row dims with Undo for 5s and then deleteSavedSearch commits. Undo keeps the original row (id, createdAt, alert windows).
- P1 notes and refresh:
- src/components/saved/note-sheet.tsx: a Dialog mobile='sheet' with a textarea (maxLength 500). On Save it calls setSavedNote, shows toast('Note saved'), awaits requestClose(), then router.refresh().
- src/components/saved/refresh-button.tsx: visible when useMediaQuery('(display-mode: standalone)'). It calls router.refresh(), and the page auto-refreshes after being hidden for 5 minutes or more.
- P1 install coach:
- src/components/pwa/install-store.ts: module-scope beforeinstallprompt capture, appinstalled, isStandalone, isIOS, isInAppBrowser, and a pure shouldShowInstall(state), unit-tested.
- src/components/pwa/install-sheet.tsx: the card at bottom calc(var(--bottom-overlay-h)+12px), the iOS steps and the in-app message, with a 30-day cooldown.
- install-entry.tsx: the menu row, hidden when standalone.
- e2e:
- e2e/mobile/pwa.spec.ts: manifest, icons, meta and SW registration.
- e2e/mobile/saved.spec.ts: tabs, rows, pending removal, unavailable homes, saved-search rows, warmPages spy, notes (P1) and axe.
- e2e/mobile/pwa-offline.spec.ts: skipped unless E2E_PROD=1; runs against `next build && next start -p 3201` in this worktree.

ACCEPTANCE:

- GET /manifest.webmanifest returns 200 with display 'standalone', id '/', start_url '/homes?source=pwa', scope '/', theme_color and background_color '#fbfaf7', 4 shortcuts, and a 512 'maskable' icon. Every icon URL returns 200 image/png whose IHDR dimensions match its declared size.
- On pixel7 and iphone13, pages include link[rel=manifest], link[rel=apple-touch-icon][sizes='180x180'] and meta[name=apple-mobile-web-app-capable]. With serviceWorkers 'allow', navigator.serviceWorker.controller is non-null after a reload.
- E2E_PROD=1, fresh context, signed in as buyer@example.com:

1. Visit only /saved and poll until caches.open('pages') holds every '/homes/<slug>' from the first 50 (at most 10s).
2. context.setOffline(true), then tap the first saved row.
3. The listing h1 is visible, the 'You're offline' banner shows, and tapping the first photo opens dialog[open]. The gallery hydrated from warmed chunks.

- E2E_PROD=1 offline relaunch:
- After visiting /homes?q=Decatur online and going offline, page.goto('/homes?source=pwa') shows an h1 containing 'Decatur', served from cache.
- Going offline to an uncached listing shows 'You're offline', with a list that includes the cached listing's title.
- User isolation: sign in as buyer and open 2 listings, then clear cookies and sign in as daniel@adamsrealty.example in the same context. On the next load the pages cache holds no HTML containing 'buyer@example.com', and a stubbed PushSubscription.unsubscribe was called before the caches were cleared.
- context.setOffline(true) shows 'You're offline' within 2s, and it disappears within 2s of reconnecting. The banner has role=status and no aria-live attribute, and /homes still has exactly one [aria-live=polite].
- As buyer on pixel7 and iphone13, both /saved tabs are in the first viewport, and tapping Searches shows the saved searches without scrolling. In the phone variant each home row is at most 140px tall, its heart is at least 44x44, and it shows 'Listing by' when the listing has an office.
- Pending removal:
- Tapping a row's heart dims the row and shows a toast with Undo.
- Tapping Undo within 5s restores aria-pressed='true' and sends no POST. withDb shows the same saved_listings.created_at and note as before.
- With no Undo, the home is gone after reload once 6s have passed.
- Navigating to / within 5s and returning shows the home removed.
- A buyer-saved listing whose removed_at is set via withDb appears under 'No longer available (1)'. Remove deletes it, it stays gone after reload, and the test restores the data.
- On iphone13 a saved search name renders on one line at least 200px wide. The frequency select is at least 44px tall with a computed font-size of at least 16px (also on iphone13-landscape and ipad-mini), and delete is at least 44x44.
- Changing frequency shows 'Alerts:' in a toast and persists after reload.
- Changing it with the network offline reverts the select and shows an error toast.
- Delete followed by Undo keeps the same saved_searches.id in the database.
- On /saved, CACHE_PAGES is posted with up to 50 '/homes/<slug>' URLs (init-script spy on the controller's postMessage). Without a controller it is a verified no-op.
- P1: the note 'Loved the porch' shows on its row after reload. setSavedNote for a listing the buyer has not saved returns {ok:false} and inserts nothing. With display-mode standalone stubbed, the Refresh button is visible, at least 44px, and triggers a refresh.
- P1: install-store.test.ts shows shouldShowInstall is false on the first visit, when standalone, in in-app browsers and within 30 days of a dismissal, and true after 3 viewed listings. The install card never renders on first load in e2e.
- sw-assets.test.ts passes on a captured listing HTML fixture. Lint, typecheck and unit tests pass. The existing desktop and mobile public.spec, accounts.spec and dashboard.spec pass unchanged. axe reports 0 serious or critical issues on both /saved tabs and on /offline for pixel7, iphone13, iphone13-landscape and ipad-mini.

DARK MODE (hand-off from DM):

- The manifest's `theme_color` and `background_color` stay #fbfaf7: a manifest can't vary by colour scheme, and the page's own `theme-color` pair (THEME_COLORS) takes over once it loads.
- Decide `appleWebApp.statusBarStyle` here (today `"default"` in layout.tsx, so an installed iOS app draws a light status bar even in dark mode). `black-translucent` plus the safe-area padding the header already has is the likely answer; test it under both schemes in standalone mode.
- Manifest icons are unaffected. /saved and /offline join the dark axe matrix.

ALL OF GEORGIA (hand-off from GA-A):

- WP1 owns `src/lib/listings/queries.ts`: keep `getFeaturedListings`' firm filter (`firmAreaCondition` or company listing), `FEATURED_MIN`, `getTopCities` and `getPlacesIndex` as they are (the seed and `featured.db.test.ts` check them).

## WP2 App shell: tab bar, mobile header and menu, save-through-sign-in, auth polish, home page and owned-page sweep

features: ['F06', 'F07', 'F08', 'F09', 'F10', 'F49', 'F40', 'F47', 'F34', 'F36']
owns: ['src/components/layout/site-header.tsx', 'src/components/layout/tab-bar.tsx', 'src/components/layout/site-footer.tsx', 'src/components/layout/logo.tsx', 'src/components/listings/saved-homes-provider.tsx', 'src/components/auth/auth-shell.tsx', 'src/components/auth/auth-forms.tsx', 'src/app/(auth)/sign-in/page.tsx', 'src/app/(auth)/sign-up/page.tsx', 'src/app/(auth)/forgot-password/page.tsx', 'src/app/(auth)/reset-password/page.tsx', 'src/proxy.ts', 'src/app/(site)/page.tsx', 'src/app/(site)/account/page.tsx', 'src/components/account/account-forms.tsx', 'src/app/(site)/sell/page.tsx', 'src/app/(site)/agents/page.tsx', 'src/app/(site)/agents/[slug]/page.tsx', 'src/app/(site)/about/page.tsx', 'src/app/(site)/accessibility/page.tsx', 'src/app/(site)/contact/page.tsx', 'src/app/(site)/fair-housing/page.tsx', 'src/app/(site)/privacy/page.tsx', 'src/app/(site)/terms/page.tsx', 'src/app/(site)/areas/page.tsx', 'src/app/(site)/areas/[slug]/page.tsx', 'src/app/(site)/alerts/unsubscribe/page.tsx', 'src/app/(site)/alerts/unsubscribe/submit-button.tsx', 'src/components/areas/area-agents.tsx', 'src/components/areas/area-card.tsx', 'src/components/areas/area-cta.tsx', 'src/components/areas/area-sort-nav.tsx', 'src/components/areas/market-snapshot.tsx', 'src/components/areas/recent-sales.tsx', 'src/components/content/contact-cta.tsx', 'src/components/content/contact-methods.tsx', 'src/components/content/legal.tsx', 'src/components/content/page-intro.tsx', 'src/components/content/toc-nav.tsx', 'src/app/not-found.tsx', 'src/app/error.tsx', 'src/app/forbidden.tsx']
new: ['src/components/layout/mobile-menu.tsx', 'src/components/layout/use-scroll-direction.ts', 'src/components/layout/back-button.tsx', 'src/server/actions/save-intent.ts', 'src/components/home/returning-visitor.tsx', 'src/components/home/snap-row.tsx', 'src/components/home/theme-color-sync.tsx', 'src/components/auth/password-input.tsx', 'e2e/mobile/shell.spec.ts', 'e2e/mobile/home.spec.ts', 'e2e/mobile/content.spec.ts']

ALREADY BUILT (site review #1, before the packages; keep it):

- F08 save-through-sign-in exists: `src/server/actions/save-intent.ts` (`ensureSaved`, idempotent, checks `can.saveListing`, the uuid and that the listing is shown and not removed) and the `?save=` effect in `saved-homes-provider.tsx` (it drops `save=` with a router-synced `history.replaceState`, so no server request, then saves, sets the heart and toasts 'Saved to your homes' with View). A signed-out heart pushes `/sign-in?next=<path + whole query + save=<id>>&reason=save` (`saveIntentNext`). WP2 keeps these and the e2e case in `e2e/back-nav-suite.ts` ("signing in from a heart").
- Sign-in and sign-up `router.replace(next)`, so Back from the page they land on skips the sign-in page (which would bounce forward again).
- The results list comes back where it was after the sign-in round trip: the heart tap saves the list's place (search-view.tsx), and `save=` doesn't change its key.
- back-button.tsx (standalone Back) should follow the same rule as `ReturnLink` (`src/components/layout/return-link.tsx`): router.back() only when the previous entry is this site's.

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 2` (port 3102, database adams_wp2). This package starts only after G0, because site-footer.tsx, the account files, (site)/page.tsx and the content/area pages are #10 paths.
- src/components/layout/tab-bar.tsx (replaces the stub), 'use client', as specified in F06:
- nav[data-tabbar][data-bottom-bar=tab], with 'phone:flex wide:hidden fixed inset-x-0 bottom-0 z-40 h-[calc(var(--tabbar-h)+var(--sai-bottom))] pb-safe pl-safe pr-safe'.
- Search href from useLocalValue(STORE_KEYS.lastSearch) → lastSearchHref(), falling back to /homes.
- Saved shows the useSavedHomes().count badge.
- Signed-out Saved links to /sign-in?next=%2Fsaved&reason=saved; signed-out Alerts uses reason=alerts.
- Staff get Leads in place of Alerts.
- aria-current follows pathname plus the tab param.
- Never return null by pathname; visibility is entirely the foundation CSS markers.
- src/components/listings/saved-homes-provider.tsx: F08.
- A signed-out toggle builds next from location.pathname plus search, with save=<id> appended, and pushes /sign-in?next=…&reason=save.
- An effect: when signed in and ?save=<uuid> is present, call ensureSaved(id), then setLocal(id, true), then toast('Saved to your homes', {action: View → /saved}), then router.replace the URL without save.
- Keep reconcile, count and setLocal.
- src/server/actions/save-intent.ts, 'use server' ensureSaved(listingId):
- getActor plus can.saveListing, else {ok:false, error:'unauthenticated'};
- validate the uuid; the listing must have removed_at null;
- onConflictDoNothing, then revalidatePath('/saved').
- src/components/layout/site-header.tsx:
- In the phone variant, drop the Saved heart and the Sign in pill; wide is unchanged.
- use-scroll-direction.ts: passive listener, rAF, 8px hysteresis, only past 64px. Apply phone:-translate-y-full when scrolling down on non-hero pages; disabled while the menu is open; instant under reduced motion.
- back-button.tsx: a 44px chevron when standalone and not a tab root. It calls router.back() for same-origin history, else links to /.
- The avatar trigger uses Popover unstyled with a size-11 avatar.
- Sign-out: await prepareSignOut(); await authClient.signOut(); router.replace('/'); router.refresh(); toast('Signed out').
- <MobileMenu user={user} />.
- No pathname-based hiding.
- src/components/layout/mobile-menu.tsx:
- Dialog mobile='sheet' with closeOnBack.
- Account block, or 44px 'Sign in' and 'Create account'.
- 48px links (Buy, Rent, Sell, Agents, Saved homes, Alerts, Account, plus Dashboard for staff), each onClick={e => {e.preventDefault(); navigateFromDialog(href)}}.
- <InstallEntry />.
- 44px Call office (telHref(site.phone)) and Email office (mailtoHref).
- Sign out.
- Footer and logo:
- src/components/layout/site-footer.tsx: telHref for the phone link, and py-2.5 on link rows in the phone variant; no change at sm and above.
- src/components/layout/logo.tsx: an optional compact prop that shows the mark only.
- Auth:
- src/components/auth/auth-shell.tsx: render data-own-chrome='bottom'. In the phone variant use 'items-start pt-6' and drop the 100dvh centering.
- password-input.tsx: a 44px Show/Hide toggle (aria-pressed, aria-controls), used in auth-forms.tsx for sign-in, sign-up and reset.
- auth-forms.tsx: 'Forgot?' gets py-3 -my-3, and the email field gets autoCapitalize='none'. Keep #email, #password and the submit type.
- sign-in/page.tsx and sign-up/page.tsx: add REASONS saved ('Sign in to see your saved homes on any device.'), alerts ('Sign in to manage alerts for your saved searches.') and tour. Sign-up keeps next and reason.
- src/proxy.ts: add reason=saved for /saved and reason=account for /account to its redirect. The matcher and the cookie-only check are unchanged.
- src/app/(site)/page.tsx (P1):
- In the phone variant, shorten the hero (min-h-[78svh] sm:min-h-[92svh]) and make the Popular chips h-11.
- Put <ReturningVisitor /> right after the hero: a 'Continue your search' card from lastSearch, and a 'Recently viewed' SnapRow of snapshot tiles. Tiles are not article elements and each shows 'Listing by <office>'. Render nothing when there is no local data.
- snap-row.tsx: below sm, 'flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scrollbar-none -mx-4 px-4 gap-4 [&>_]:w-[82%] [&>_]:shrink-0 [&>*]:snap-start'; the existing grid from sm up. Use it for Featured, New on the market, Neighborhoods and Agents.
- Hide marketing-only paragraphs below sm.
- theme-color-sync.tsx (F49).
- Keep the h1 text and the ListingCard articles. Never add transform, filter or will-change to the hero; the foundation neutralizes isolate during full-screen search.
- Sweep of owned pages (P1): /account, /sell, /agents, /agents/<slug>, /about, /contact, /accessibility, /fair-housing, /privacy, /terms, /areas, /areas/<slug>, /alerts/unsubscribe, 404, 403 and error.
- Fix overflow, 44px targets (with an allowlist for inline prose links), and pl-safe/pr-safe on full-bleed sections.
- Replace hard-coded tel: links with telHref.
- No layout redesign.
- e2e:
- e2e/mobile/shell.spec.ts: tab bar and header marker contract, tabs, keyboard rule, menu and history, scroll hide, sign-out, save-through-sign-in, auth.
- e2e/mobile/home.spec.ts.
- e2e/mobile/content.spec.ts: the sweep of owned pages, tagged @landscape so it also runs on iphone13-landscape and ipad-mini.

ACCEPTANCE:

- On pixel7 and iphone13, nav[data-tabbar] and [data-site-header] are both visible on /, /saved (buyer), /account (buyer), /agents, /sell and /homes/does-not-exist (the 404). The tab bar is hidden on /sign-in, via the auth-shell marker.

Marker behavior:

- Injecting <div data-own-chrome='bottom'> hides the tab bar.
- Injecting data-own-chrome='top' hides the header.
- Removing each marker restores its chrome.

Each tab is at least 44x44, the active tab has aria-current='page', and the bar's class list includes pb-safe.

- Focusing a text input (the location pill or the /sign-up name) hides the tab bar. Focusing or toggling a checkbox, and focusing a select, does not.
- After visiting /homes?q=Decatur&beds=3 (recorded by the foundation's recordSearch), going to / and tapping Search lands on /homes?q=Decatur&beds=3.
- Signed out, tapping Saved lands on /sign-in?next=%2Fsaved&reason=saved, which shows the saved explainer text. Signed in as buyer, the Saved badge equals the number of saved homes and Alerts links to /saved?tab=searches. Signed in as daniel@adamsrealty.example, the third tab is 'Leads' and links to /dashboard/leads.
- At 1280x800 and at 800x1000 with a fine pointer, the tab bar is not visible, and the header shows the Buy/Rent/Sell/Agents links, Saved and the avatar or Sign in exactly as before.
- Phone menu:
- The header shows only the logo and the hamburger.
- The hamburger opens dialog[open] with a scrim. A scrim tap closes it and the URL is unchanged. page.goBack() with the menu open closes it and stays on the page.
- Starting from /sell, tapping 'Agents' in the menu lands on /agents with history.length grown by exactly 1, and a single page.goBack() returns to /sell with no dialog open.
- On /agents, scrolling down 600px moves the header out of view, and scrolling up 100px shows it fully again.
- Signing out from /account as buyer lands on exactly '/', shows the toast 'Signed out', and leaves caches.has('pages') false. A stubbed PushSubscription.unsubscribe resolves before the /api/auth/sign-out request starts, checked by request-log order.
- Signed out on pixel7, tapping the first card heart on /homes navigates to a URL matching /\/sign-in\?next=.*save%3D[0-9a-f-]{36}/. After signing in as buyer:
- the user is back on the originating page;
- that card's heart has aria-pressed='true';
- 'Saved to your homes' is visible;
- the URL has no 'save='.
  The existing 'anonymous save prompts sign-in' test passes unchanged.
- On iphone13 /sign-in, the email input's top is at most 220px. The password reveal toggles the type between password and text. The 'Forgot?' box is at least 44px tall, and all inputs compute to at least 16px (also on iphone13-landscape).
- P1 home, on iphone13:
- The document height is at most 7,500px (from 12,291).
- The featured row has scroll-snap-type x and scrollWidth > clientWidth, while the document's scrollWidth equals its clientWidth.
- After opening two listings, 'Recently viewed' shows both street addresses, each with a 'Listing by' line, and a 'Continue your search' link points to the last search.
- P1: while the hero is in view, the first meta[name=theme-color] that applies is '#0f2a20'; after scrolling past it, it is the resolved canvas colour ('#fbfaf7' in light, '#0f1412' in dark). Tested under both colour schemes, and with Dark forced.
- On iphone13-landscape with simulateNotch({left:47, right:47, bottom:21}):
- the header logo's left edge is at least 47px from the left, and the hamburger's right edge is at least 47px from the right;
- the tab bar is 48px plus the bottom inset;
- there is no horizontal overflow on /, /agents and /account.
- content.spec passes on pixel7, iphone13, iphone13-landscape and ipad-mini for every owned page: no overflow, controls at least 16px, targets at least 44px (inline prose links allowlisted), and axe reports 0 serious or critical issues.
- Lint, typecheck and unit tests pass. The existing public.spec (desktop and mobile), accounts.spec and dashboard.spec pass unchanged.

DARK MODE (hand-off from DM):

- Keep `<ThemeMenuButton>` in the wide header (`hidden wide:block`, first in the right-hand group). `mobile-menu.tsx` renders `<AppearanceControl variant="segmented">` (the sheet replaces today's inline phone menu, which carries it now), so phones, iphone13-landscape and ipad-mini keep a reachable switch and no sun/moon button.
- F49's `theme-color-sync.tsx` calls `setChromeColor("#0f2a20")` while the hero is in view and `setChromeColor(null)` afterwards and on unmount; it never writes meta tags itself. The F49 acceptance below reads "the resolved canvas colour" (#fbfaf7 in light, #0f1412 in dark), tested under both colour schemes.
- Keep the `on-ink`, `surface` and `shade` classes the dark-mode renames put in the header, home page, auth shell, area pages and cards.
- The owned-page sweep (content.spec) and home.spec run axe with Dark forced too.

ALL OF GEORGIA (hand-off from GA-A):

- Home page (`(site)/page.tsx`): the hero label is "All of Georgia"; the town chips are `getCachedTopCities(12)` in one swipeable row on phones (`[data-top-cities]`), ending with "See all towns" → `/places`. A redesign (snap-row) keeps them data-driven and keeps the link.
- "Handpicked by our agents" renders only with `FEATURED_MIN` (4) or more homes and shows only what `getCachedFeaturedListings` returns. No "monthly cost" wording anywhere on the home page, including returning-visitor rows.
- Footer (`site-footer.tsx`, an async server component): the Places column is `getCachedTopCities(6)` plus "All towns" and "Area guides"; its blurb keeps "across Georgia, with agents serving Northeast Georgia" and the no-ads/never-sell sentence word for word. The light regression masks its town links (`[data-footer-column='Places']`).
- `/places` (the statewide places index, `src/app/(site)/places/page.tsx`) joins WP2's owned-page sweep; it is already in the dark axe matrix.
- Contact and about copy: the office "assigns one of our agents"; NEXT_STEPS never claims local knowledge statewide.

## WP3 Search map and results sheet: detents, pin strip, restoration, relaunch, map fixes, cards with all-in monthly, freshness footer

features: ['F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F45', 'F46', 'F47', 'F35', 'F36']
owns: ['src/components/search/search-view.tsx', 'src/components/search/search-map.tsx', 'src/components/search/map-setup.ts', 'src/components/search/pagination.tsx', 'src/components/listings/listing-card.tsx', 'src/lib/search/service.ts', 'src/app/homes/page.tsx']
new: ['src/app/homes/(search)/page.tsx', 'src/app/homes/(search)/loading.tsx', 'src/components/search/map-sheet.tsx', 'src/components/search/use-sheet-drag.ts', 'src/lib/search/sheet-snaps.ts', 'src/lib/search/sheet-snaps.test.ts', 'src/components/search/map-preview-strip.tsx', 'src/components/search/results-header.tsx', 'src/components/search/results-footer.tsx', 'src/components/search/use-search-restoration.ts', 'src/lib/search/last-search.ts', 'src/lib/search/last-search.test.ts', 'e2e/mobile/search-map.spec.ts']

ALREADY BUILT (site review #1, before the packages; keep it and build the sheet on it):

- F13 restoration exists for today's list: `usePlaceRestoration` in search-view.tsx with `src/lib/search/restore.ts` (sessionStorage `ar:search:<path+query without the sheet view and save=, params sorted>` → {scrollTop, slug, view, savedAt}, 30 minutes). It saves on a card or heart tap (capture phase), when the search changes, on unmount, on pagehide and on visibilitychange, and restores on mount (client Back, reload, "Back to results"). The tapped card gets `data-returned` for 2.4s (a 3px `outline-primary`, not `ring-2`, so the "no ring-2 after a touch tap" acceptance still holds) and focus. WP3 moves it into `use-search-restoration.ts`, adds the detent to the stored value and points it at the sheet body on phones; `e2e/back-nav-suite.ts` must keep passing (10th card, Back, within 50px, on desktop, pixel7 and iphone13).
- The list/map toggle already keeps its mode in the URL: map is `view=map`, list is no sheet value, written with `setView()` (no request) and `setLastSearchView()`. The sheet replaces the toggle and keeps the values (map = peek); a URL without a value becomes half.
- The map preview's link opens the home with `router.push` (it is plain DOM), so Back returns to the map as it was; the strip's cards must do the same.
- Filter, sort and map changes replace the history entry (`update()` default); a new place and a new page push (`{ push: true }`). `markReturn("search", …)` on a card or preview tap makes the listing's "Back to results" act like Back; the strip's cards go through the same capture handler.

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 3` (port 3103, database adams_wp3).
- Move src/app/homes/page.tsx to src/app/homes/(search)/page.tsx. The URL stays /homes; the old file is deleted. Add src/app/homes/(search)/loading.tsx next to it. Because the skeleton is inside the route group, it can never wrap /homes/[slug], whatever order WP3 and WP5 merge in.
- In the page:
- F45: when searchParams has source=pwa and no other criteria, read the cookie ar_last_search and redirect() to lastSearchRedirect(cookie). That function lives in src/lib/search/last-search.ts: it runs parseSearchParams, then serializeCriteria, plus view ∈ {map, list}; it always returns a /homes path, and it is tested against open-redirect and XSS inputs.
- Pass initialView.
- Add getFreshness() and the distinct dataSources.disclaimer text (IDX: /homes is outside the (site) layout) as props.
- Metadata and canonical are unchanged.
- src/components/search/search-view.tsx restructure, keeping one DOM for all sizes:
- Root: <main data-app-shell className='relative flex flex-col phone:h-[calc(100dvh-var(--top-chrome-h)-var(--bottom-chrome-h))] phone:overflow-hidden wide:h-[calc(100dvh-var(--header-h))]'>. The foundation CSS zeroes #main padding for app-shell pages.
- In the phone variant, FilterBar goes in <div data-search-topbar className='absolute inset-x-0 top-0 z-20 pt-safe'>, measured with a ResizeObserver. No transform, filter or will-change on it.
- Map pane: phone:absolute phone:inset-0, and wide:flex-1 wide:border-l.
- Results pane: wrapped by MapSheet in the phone variant; wide:w-[56%] xl:w-[52%] 2xl:w-[48%] overflow-y-auto. The list container is `@container/results` and the grid is 'grid-cols-1 @min-[36rem]/results:grid-cols-2'.
- Remove the Map/List FAB.
- Keep the h1 'Homes for sale in X' and the recordSearch effect.
- Phones: searchAsMove comes from ar:searchAsMove (default false). The 'Search this area' pill (44px) sits at top calc(var(--top-chrome-h) + topbarH + 8px).
- src/components/search/results-header.tsx: in the phone variant it is the sheet's sticky header. It contains:
- the only aria-live='polite' paragraph ('{n} results' plus the criteria summary, with the wording the existing regex expects);
- a 44px Sort <select> ('text-sm pointer-coarse:text-base') with SORTS and sortLabel;
- a 'No paid placement' info button that reveals SORT_HELP;
- the single <SaveSearchButton criteria signedIn />, moved here from the foundation spot, at every size.
- Sheet mechanics:
- src/lib/search/sheet-snaps.ts (pure, tested): computeSnaps({shellH, topBarH}) returns {full, half, peek}, with peek 96 or 72 and half 52% or 50% when the shell is under 360px. Also projectTarget(y, v, snaps, 200) and rubberBand(y).
- use-sheet-drag.ts and map-sheet.tsx implement F11: pointer capture; pointercancel treated as pointerup; rAF translate3d; a native touchmove {passive:false} handoff; a touch-action class swap only when the sheet settles; a handle <button> with aria-expanded and Enter/Space cycling.
- onSettle(detent, visiblePx) calls setView() from use-search-nav, then setLastSearchView(), then map padding.
- A focusin from keyboard (:focus-visible) inside the body while the sheet is not full expands it to full.
- The SSR start position comes from initialView through an inline CSS variable.
- src/components/search/search-map.tsx:
- One map.on('click') handler with a ±12px (touch) or ±4px (mouse) queryRenderedFeatures box, checking pins-active, pins, pin-dots, then clusters.
- An onSelect prop, and a desktop Popup created once.
- touchPitch false. NavigationControl only for fine pointers.
- A padding prop applied with easeTo({padding, duration: 250}).
- Create the map with whenIdle(fn, {timeout: 400}); on the first non-zero size, resize() and fit.
- selectedId and highlightedId drive pins-active.
- The error overlay 'Map unavailable offline'.
- P1: GeolocateControl on coarse pointers, with an explicit onUserMove after moveend.
- In non-production builds, expose window.__arMap.
- src/lib/search/service.ts: MapPin gains listOfficeName, taxAnnualAmount, hoaFee and hoaFrequency. Add getFreshness(), the max dataSources.lastSyncedAt, and getDisclaimers().
- src/components/search/map-preview-strip.tsx implements F12:
- 85vw div role='group' items with data-testid='preview-address';
- the 'est. $X/mo' line via quickMonthlyCost, and 'Listing by <office>';
- a plain SaveButton;
- items ordered by haversine distance, at most 40;
- an IntersectionObserver (threshold 0.6) that highlights the centered card and pans the map;
- a 44px close button that restores the previous detent.
- src/components/search/use-search-restoration.ts implements F13 for both the sheet body and the desktop scroller.
- src/components/search/results-footer.tsx sits at the end of the list:
- freshness(lastSyncedAt): fresh shows 'Updated N min ago from <source>'; stale shows the notice and no 'Updated' claim;
- the MLS disclaimers;
- 'No paid placement'.
- src/components/listings/listing-card.tsx implements F15 and F16:
- onPointerEnter and onPointerLeave act only for e.pointerType === 'mouse';
- an inner Pressed element using useLinkStatus;
- a pointer-coarse: photo-count chip, while the hover arrows stay for fine pointers;
- for sale listings, an 'est. {formatMonthly(quickMonthlyCost(...))} all-in' muted line under the price;
- keep article, 'article a', data-testid='card-address', 'Listing by' and SaveButton.
- src/components/search/pagination.tsx: size-11 on coarse pointers. The scroll target is the sheet body on phones.
- e2e/mobile/search-map.spec.ts covers detents, drag and fling, keyboard, focus expansion, setView without requests, the pin strip, restoration, the relaunch redirect, Search this area, the card monthly line, md–lg width, the freshness footer (withDb sets last_synced_at and restores it), landscape (tagged @landscape) and the contracts.

ACCEPTANCE:

- On pixel7 and iphone13 at /homes?q=Decatur:
- There is exactly one main landmark.
- The map canvas width equals the viewport width.
- The sheet top is at 48% ±5% of the shell height.
- The shell bottom equals the tab bar top, and the document does not scroll (scrollHeight === innerHeight).
- The handle has aria-expanded.
- document.querySelectorAll('[aria-live=polite]').length === 1, and its text matches /\d+ results?/.
- touchDrag from the handle up by 300px settles at full, with the sheet top within 16px of the [data-search-topbar] bottom. A fast downward fling settles at peek. The list scrolls only at full. Enter on the focused handle cycles peek, half, full. Tabbing into the first card while at half expands the sheet to full. pointercancel mid-drag settles at a detent.
- Changing the detent updates the URL to view=map or view=list with no document request and no request carrying an RSC header. On first paint of /homes?view=map, the sheet's transform equals the peek transform.
- Tapping a price pin (coordinates from window.__arMap.project) shows the strip within 500ms. The first [data-testid=preview-address] equals the tapped pin's address. Each sale strip card contains 'est. $' and '/mo', and contains 'Listing by' when the listing has an office. Swiping to the second card switches pins-active. There is exactly one selection per tap. Tapping a card navigates to /homes/<slug>.
- At full, scrolling to the 10th card, opening it and pressing Back restores the same detent, with scrollTop within 40px.
- Relaunch redirect:
- A GET of /homes?source=pwa with the cookie ar_last_search='q=Decatur&beds=3&view=list' responds with a redirect to /homes?q=Decatur&beds=3&view=list.
- Cookies of '//evil.com' or 'q=<script>' redirect only to a sanitized /homes URL.
- Without the cookie, the default search renders.
- Panning on phones does not change the URL until 'Search this area' is tapped; after that the URL has bounds=. At 1280, the 'Search as I move the map' checkbox is checked, and panning updates bounds, as today.
- Exactly one button named 'Save search' exists on /homes at 390, 800 and 1280 wide.
- After a touch tap on a card and Back, no card has the ring-2 class. The heart is at least 44x44 on coarse pointers. Every sale card shows 'est. $N/mo all-in', matching quickMonthlyCost for that card's price, tax and HOA (from the API fixture) within $1. Rental and sold cards show no monthly line.
- At 800x1000 with a fine pointer, every result card is at least 300px wide (one column). At 1280 there are two columns.
- With withDb setting last_synced_at to now(), the results footer shows 'Updated' and 'from'. With now() − 3h, it shows the stale notice and no 'Updated … ago'. The MLS disclaimer text is present. The test restores the data.
- On iphone13-landscape (844x390), /homes uses the phone shell (sheet, no split pane), the half detent shows at least 150px of list, and there is no horizontal overflow. On ipad-mini (744x1133), the phone shell renders with no overflow.
- Navigating from /homes to a listing never shows the search skeleton: no [data-skeleton=search] appears during the navigation. The existing public.spec passes unchanged on desktop and on the Pixel 7 mobile project, including 'search is URL-driven', 'location autocomplete' and 'property page', with the first 'article a' clickable at half.
- sheet-snaps.test.ts and last-search.test.ts pass. Lint and typecheck pass. axe on /homes reports 0 serious or critical issues on pixel7, iphone13, iphone13-landscape and ipad-mini.

DARK MODE (hand-off from DM):

- search-map.tsx: keep `installOverlays` on every `style.load`, the theme swap `swapDrawnStyle(..., carryOverlays)` (which marks the new style only once it has arrived, never on an `idle` of the old one), the missing-image resolver, the handlers registered once, `MAP_OVERLAY_COLORS` (pins look the same in both themes) and the dev-only `window.__searchMap` that e2e/theme.spec.ts reads. The map is created on `mapStyleUrl(readResolvedTheme())`, so it never starts on the wrong style; its theme then comes from `useMapTheme()` (light while printing), and `markDrawnStyle` marks each drawn style for the print CSS.
- New map layers (clusters, the pin strip's highlight) go in `OVERLAY_LAYERS` so a theme swap carries them. The map's placeholder uses `bg-map`.
- The results sheet, pin strip and cards follow the tokens; the sheet's handle and scrim use `shade`.
- /homes stays in the dark axe matrix; the theme map tests (pins drawn after each swap, no light style requested on a dark page, no console warnings) pass.

ALL OF GEORGIA (hand-off from GA-A):

- search-map.tsx: the first view is `initialView(bounds, pins)`: the search's bounds, else its pins, else `site.coverage.bounds` (padding 24), always a fit. Keep `pendingFit`: a fit asked for while the map is hidden (0×0 behind the list on phones) runs when it is first shown. The sheet's detents change when the map is visible; `e2e/mobile/georgia-map.spec.ts` must keep passing (the map opens snug on the search).
- search-view.tsx: the heading falls back to `site.coverage.name` ("Homes for sale in Georgia"). homes/page.tsx: titles per mode say Georgia ("Recently sold homes in Georgia" for sold), and the description never says "local agents".
- Cards with an all-in monthly (F13): use `financeFor(county)` so coastal insurance and the metro tax fallback match the listing page (`quickMonthlyCost` takes a model built from it).

## WP4 Search input and filters: compact bar, full-screen search, filters sheet with live count, near me, keywords and wider autocomplete

features: ['F18', 'F19', 'F20', 'F21', 'F43', 'F34', 'F36']
owns: ['src/components/search/filter-bar.tsx', 'src/components/search/more-filters.tsx', 'src/components/search/location-search.tsx', 'src/components/search/hero-search.tsx', 'src/components/search/save-search-button.tsx', 'src/lib/search/params.ts', 'src/lib/search/params.test.ts', 'src/lib/search/query.ts', 'src/lib/search/query.test.ts', 'src/app/api/locations/suggest/route.ts']
new: ['src/components/search/filters-sheet.tsx', 'src/components/search/quick-filters.tsx', 'src/components/search/search-suggestions-panel.tsx', 'src/components/search/near-me-button.tsx', 'src/components/search/use-result-count.ts', 'src/components/search/price-range.tsx', 'src/app/api/search/count/route.ts', 'src/lib/search/count-key.ts', 'src/lib/search/count-key.test.ts', 'src/lib/search/geo.ts', 'src/lib/search/geo.test.ts', 'src/lib/search/suggest.ts', 'e2e/mobile/search-filters.spec.ts']

ALREADY BUILT (site review #1, before the packages; keep it):

- `useSearchNav().update()` replaces the history entry by default: filter, sort, mode and map changes never add a Back step (owner decision). A new place (`LocationSearch`) and a new page push with `{ push: true }`. The filters sheet follows the same rule: Apply is `navigateFromDialog(href, { replace: true })`.

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 4` (port 3104, database adams_wp4).
- src/components/search/location-search.tsx:
- Ghost-tap fix: option onPointerDown and onMouseDown only call preventDefault; choose(s) runs in onClick; after choosing, exit full-screen, blur, then onSearch.
- The md size becomes 'text-sm pointer-coarse:text-base'.
- fullscreenOnMobile (default true): in the phone variant, onFocus sets the data-search-fullscreen attribute on the <form>, with classes 'fixed inset-0 z-[60] bg-canvas pt-safe pl-safe-4 pr-safe-4 flex flex-col'. The same <input> stays mounted.
- A 44px Cancel button.
- The listbox is static, fills the rest of the panel and uses overscroll-contain.
- With an empty term, render <SearchSuggestionsPanel>: optional mode chips, 'Use my location' via NearMeButton, readRecentSearches() and the busiest towns (getCachedTopCities, passed down from the server; site.featuredAreas no longer exists).
- Escape or Cancel exits.
- Keep role=combobox and the label 'Search by location'.
- Never put transform, filter or will-change on the form's own wrappers.
- src/components/search/hero-search.tsx: tabs h-11 on coarse pointers. Pass the mode so the full-screen panel shows Buy/Rent/Sold chips. Keep router.push(searchHref({mode, q})).
- src/components/search/filter-bar.tsx, phone variant:
- Root <div data-own-chrome='top' className='relative …'>.
- First child: <div aria-hidden className='absolute inset-0 rounded-b-2xl bg-canvas/90 backdrop-blur shadow-card'/>, the blur as a sibling layer.
- Content in a relative (z-auto) wrapper: LogoMark home link, LocationSearch pill, and a 44px Filters button with a countActiveFilters badge, then <QuickFilters />.
- The wide variant keeps the desktop bar and popovers.
- No SaveSearchButton.
- An effect: when near=1, run near-me once, then router.replace without near.
- src/components/search/filters-sheet.tsx (F20):
- Dialog mobile='fullscreen' closeOnBack.
- The draft is the criteria minus q, bounds and page.
- Section ids for initialSection scrolling.
- price-range.tsx: preset chips plus min/max selects (text-base on coarse pointers).
- 48px toggle chips with aria-pressed.
- Sort as a radiogroup with SORT_HELP.
- A sticky footer with pb-safe, 'Reset all', and 'Show {n} homes' from useResultCount(draft).
- Apply: await navigateFromDialog(buildSearchHref(criteria, draft), { replace: true }). Never call update() followed by history.back().
- The draft is keyed on the JSON of the URL criteria.
- Live count:
- src/components/search/use-result-count.ts: 150ms debounce, AbortController, returns {count, loading, error}. The label shows 'Counting…' while loading.
- src/app/api/search/count/route.ts: parseSearchParams, then db.select({total: count()}).from(listings).where(buildWhere(c)). Rate-limit with rateLimit(`count:${clientKey(headers)}`, 120, 60_000); excess gets 429. Cache-Control 'public, s-maxage=30, stale-while-revalidate=120'.
- src/lib/search/count-key.ts: clientKey(headers) = the first x-forwarded-for entry, else 'unknown'. This matches inquiries.ts and is unit-tested. Route files may only export handlers.
- Desktop and save-search:
- src/components/search/more-filters.tsx: the footer shows 'Show {n} results' via useResultCount. The layout in the wide variant is unchanged.
- src/components/search/save-search-button.tsx: rendered by WP3's ResultsHeader with unchanged props. On phones: an icon plus 'Save', 44px, aria-label 'Save search'. The dialog becomes a sheet on phones. On success it shows 'Search saved — alerts: <frequency>', a link to /saved?tab=searches and Done (requestClose). The signed-out redirect is unchanged.
- Near me:
- src/lib/search/geo.ts (tested): boundsAround(lat, lng, miles) and inGeorgia(lat, lng).
- src/components/search/near-me-button.tsx implements F21, with toasts from the foundation.
- src/components/search/quick-filters.tsx: 44px chips. Price, Beds and Home type open FiltersSheet at their section; Near me; Open houses toggles openHouse.
- P1 keywords (F43): in params.ts, parse and serialize kw (trimmed, at most 60 characters), count it as an active filter, and describe it as 'with “…”'. In query.ts, kw adds searchVector @@ websearch_to_tsquery('english', kw). Add a Keywords input to FiltersSheet and MoreFilters. Tests go in params.test.ts and query.test.ts.
- P1 autocomplete (F43):
- src/lib/search/suggest.ts: getSearchSuggestions(term) runs the existing area and address queries, plus an exact mls_number match that returns {kind:'listing', href:'/homes/<slug>'}, plus a county prefix match ({kind:'county', label:'<County> County'}).
- query.ts locationCondition adds county ilike, with a normalizer that strips a trailing ' County'.
- src/app/api/locations/suggest/route.ts switches to suggest.ts; listings/queries.ts is untouched.
- LocationSearch navigates directly for listing suggestions.
- e2e/mobile/search-filters.spec.ts:
- ghost tap (3 repetitions on / and on /homes);
- full-screen geometry and elementFromPoint;
- chrome hidden while full-screen;
- recents;
- the live count and its timing;
- one-Back-after-apply;
- Back closes the sheet;
- scrim safety at 800px;
- 16px and 44px checks (tagged @landscape);
- near-me (context.setGeolocation at 33.7748, -84.2963, with denied and out-of-state variants, and ?near=1);
- quick chips;
- count equality;
- the 429 test in a final test.describe.serial that uses a unique x-forwarded-for;
- keywords and autocomplete (P1).

ACCEPTANCE:

- On iphone13 and pixel7, typing 'Deca' in the home hero and tapping 'Decatur' lands on q=Decatur 3 out of 3 times and never on Virginia-Highland. On /homes the same flow never activates the underlying Sort select.
- In the phone variant, focusing the location input on both / and /homes gives this:
- the form is fixed and covers the viewport;
- the input's top is at most 80px;
- document.elementFromPoint at the input's center returns the input;
- elementFromPoint at the viewport center returns a node inside the form;
- [data-site-header] and nav[data-tabbar] compute display:none.
  With an empty term after one prior search, 'Recent searches' lists that search and 'Use my location' is visible. Cancel restores the compact bar. The existing 'location autocomplete suggests neighborhoods' test passes on the Pixel 7 mobile project.
- Filters sheet:
- Tapping Filters opens a dialog that covers the viewport.
- Tapping Beds 3+ sets aria-pressed='true' within 100ms, and the button label changes to 'Counting…' or a number within 300ms.
- The final N equals '{n} results' after apply.
- The URL is unchanged before apply.
- After apply, the URL is the filtered search and history.length is exactly 1 more than before the sheet opened (the sheet's own entry, now a forward entry). A single page.goBack() leaves /homes for the page before the search: filters never add a Back step (owner decision, site review #1).
- page.goBack() with the sheet open closes it and keeps the URL.
- Every control in the Filters sheet is at least 44px tall. Every input and select on /homes (compact bar, sheet, save-search dialog) computes a font-size of at least 16px on pixel7, iphone13, iphone13-landscape and ipad-mini.
- GET /api/search/count?q=Decatur&beds=3 returns {total: n}, equal to the count on /homes?q=Decatur&beds=3. In the final serial block, 121 requests with x-forwarded-for '203.0.113.<random>' produce a 429 on the 121st, and a following request without that header still returns 200. count-key.test.ts passes.
- Near me:
- With geolocation granted at Decatur, tapping 'Near me' navigates to /homes?bounds=… with at least 1 result.
- With permission denied, the text 'Location is off' appears.
- With a position outside Georgia, a toast mentions 'Georgia'.
- /homes?near=1 runs the lookup once and ends on a URL without near=.
- The 'Open houses' chip adds openHouse=1. 'Price' opens the sheet with the price section in view.
- In the phone variant, the FilterBar contains no 'Save search' button, is at most 112px tall and carries data-own-chrome='top', so [data-site-header] is hidden on phone /homes. The LogoMark link goes to '/'. The FilterBar root and its ancestors compute transform, filter and backdrop-filter as none; the blur sits on the aria-hidden sibling.
- At 1280, the desktop More dialog shows 'Show N results'. At 800px, tapping outside an open popover never navigates to a listing.
- P1: /homes?kw=basement returns fewer or equal results than /homes, the summary contains 'basement', and countActiveFilters counts it. Typing a seeded MLS number shows a suggestion that opens /homes/<slug>. Typing 'DeKalb' shows 'DeKalb County', and choosing it yields q='DeKalb County' with at least 1 result.
- Lint, typecheck and all unit tests pass (including the existing params and query tests, plus geo and count-key). The desktop public.spec, accounts.spec and dashboard.spec pass unchanged. axe on /homes with the Filters sheet open reports 0 serious or critical issues.

DARK MODE (hand-off from DM):

- The compact bar, full-screen search and the filters sheet follow the tokens; the full-screen panel and its suggestions use `bg-canvas`/`bg-surface`, never `bg-white`. The rules in "Every package: dark mode" apply.

ALL OF GEORGIA (hand-off from GA-A):

- Saved searches: `drizzle/0009` pinned pre-cutover searches with no location to `site.market.bounds`. A bare "Georgia"/"GA" still means no location in the parser; don't make it mean the firm's area.
- `inGeorgia` may prefilter with `site.coverage.bounds`.

## WP5 Listing page, photo viewer, action bar, tour sheet, lazy map and listing context

features: ['F24', 'F25', 'F26', 'F27', 'F28', 'F44', 'F46', 'F40', 'F35', 'F36']
owns: ['src/app/homes/[slug]/page.tsx', 'src/components/listings/photo-gallery.tsx', 'src/components/listings/contact-form.tsx', 'src/components/listings/share-button.tsx', 'src/components/listings/payment-calculator.tsx', 'src/components/listings/location-map-lazy.tsx', 'src/components/listings/location-map.tsx', 'src/components/ui/expandable.tsx', 'src/components/ui/photo.tsx']
new: ['src/app/homes/[slug]/loading.tsx', 'src/components/listings/lightbox.tsx', 'src/components/listings/use-pinch-zoom.ts', 'src/lib/pinch-math.ts', 'src/lib/pinch-math.test.ts', 'src/components/listings/listing-action-bar.tsx', 'src/components/listings/listing-top-bar.tsx', 'src/components/listings/tour-sheet.tsx', 'src/components/listings/contact-choice-sheet.tsx', 'src/components/listings/copy-address.tsx', 'src/components/listings/listing-context-links.tsx', 'src/lib/calendar.ts', 'src/lib/calendar.test.ts', 'src/components/listings/add-to-calendar.tsx', 'e2e/mobile/listing.spec.ts', 'e2e/mobile/tour.spec.ts']

ALREADY BUILT (site review #1 and #2, before the packages; keep it):

- "‹ Back to results" (`ReturnLink scope="search"`, `src/components/layout/return-link.tsx`) sits at the top left of the listing, before the breadcrumb (which is already `hidden sm:flex`). Opened from a search in this tab it acts like Back (the list comes back at the same card and scroll); otherwise it links to the last search, else /homes. The overlay Back circle and ListingTopBar's Back use the same component logic instead of "router.back() for same-origin history, else /homes".
- The lightbox already calls `useDialogHistory`: Back closes it first, and closing it any other way removes its entry.
- `ListingCtaBar` (`listing-cta-bar.tsx`) replaced the inline CTA: it hides (`data-state="hidden"`, `inert`, slid below the screen) while any part of `#contact` is on screen, and its button scrolls `#contact` into view and focuses `#c-name`. ListingActionBar keeps both rules (its 30% threshold is fine as long as the bar never covers the form's Send button).
- The form's tour submit reads 'Send tour request', so it can't be confused with the bar's 'Request a tour'. On phones the tour sheet's submit reads 'Send tour request for {day} at {time}'; desktop keeps exactly 'Send tour request'.
- The listing agent's phone is a tap-to-call link (`data-testid="agent-phone"`, `telHref`), separate from the link to the agent's page. The contact choice sheet keeps a real `tel:` link too.
- `e2e/back-nav-suite.ts` covers these on desktop, pixel7 and iphone13 and must keep passing.

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 5` (port 3105, database adams_wp5).
- src/components/listings/photo-gallery.tsx, one DOM for all sizes:
- In the phone variant the container is '-mx-4 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain aspect-[4/3] max-h-[56svh]'; the wide variant keeps the existing mosaic.
- Tiles 1–4 become 'phone:w-full phone:shrink-0 phone:snap-center wide:(existing)'.
- Slides 5..N are appended as phone-only and lazy; only photo 0 uses priority.
- A counter span '{i+1} / {N}' (not p.tabular).
- An overlay slot (children) for the Back, Share and Save circles, placed with pt-safe and pl-safe-3/pr-safe-3.
- A Grid chip.
- A tap calls openLightbox(i).
- Lightbox:
- lightbox.tsx, use-pinch-zoom.ts and src/lib/pinch-math.ts implement F25 inside the existing <dialog>. pinch-math is pure and tested: scale and anchor, pan clamp, swipe classification.
- The stage is touch-none select-none, and the old onTouchStart/onTouchEnd swipe is removed.
- It includes grid mode, the index stored per slug in sessionStorage, useDialogHistory, the +/− buttons, the keyboard and preloading.
- src/components/ui/photo.tsx gains optional draggable (default false), an onLoad passthrough and a zoomSizes hint; the change is backward compatible.
- src/app/homes/[slug]/page.tsx:
- In the phone variant, hide the breadcrumb and the Share/Save row.
- Pass the overlay buttons into PhotoGallery: Back (ReturnLink's rule: like Back when opened from a search in this tab, else the last search, else /homes), ShareButton variant='icon', and SaveButton overlay.
- Mount <ListingTopBar> (data-own-chrome='top').
- Summary order: status plus freshness(source.lastSyncedAt), where stale shows the notice and no 'Updated'; then the price (the first p.tabular in main); then the 'est. $X/mo all-in' pill linking to #costs, via quickMonthlyCost; then facts; then the h1 with <CopyAddress>.
- Similar homes use snap-row classes below sm.
- Add a 'Report a problem with this listing' mailto link.
- Replace ListingCtaBar with <ListingActionBar>.
- Remove main's pb-24, since the foundation's #main padding uses --bottom-chrome-h.
- #contact gets scroll-mt-24.
- Keep the RecordView mount (foundation), 'Listed by', the disclaimer block and the JSON-LD.
- Action bar and contact sheet:
- listing-action-bar.tsx: 'fixed inset-x-0 bottom-0 z-40 lg:hidden pt-3 pb-safe-3 pl-safe-4 pr-safe-4', with data-bottom-bar='action', data-own-chrome='bottom' and data-hide-on-keyboard. An IntersectionObserver on #contact sets data-state='hidden' at 30% or more.
- Its primary button opens TourSheet when useIsPhone(); otherwise it scrolls #contact into view and focuses #c-name.
- contact-choice-sheet.tsx: Call, Text and Email rows using deeplinks, with the agent's phone or else site.phone.
- src/components/listings/listing-top-bar.tsx:
- Always mounted, with data-own-chrome='top'.
- A fixed top bar, 48px plus pt-safe, phone-only, translucent.
- Back, the truncated address and a plain SaveButton.
- Visible when the gallery sentinel leaves the viewport.
- No p.tabular.
- src/components/listings/contact-form.tsx:
- New props: presentation: 'inline' | 'sheet' and agent?: {name, photoUrl, phone}.
- A date-chip row with tomorrow preselected.
- A radiogroup of 44px time chips with a hidden tourTime field.
- An In person / Video radiogroup (aria-checked).
- The privacy line from F27.
- Inputs use 'pointer-coarse:text-base' through form.tsx.
- On phones the submit reads 'Send tour request for {day} at {time}'; desktop keeps exactly 'Send tour request'.
- Success copy: 'An Adams agent will reply during business hours ({site.hours}).' This replaces the invented 'We usually reply within the hour during business hours.'
- Success actions: 'Text {first name}' and Done.
- Keep the ids c-name, c-phone, c-email and c-message.
- src/components/listings/tour-sheet.tsx:
- Dialog mobile='sheet' closeOnBack with the agent header.
- It renders <ContactForm presentation='sheet'> only while open and useIsPhone().
- On phones the #contact aside renders a summary card; the form renders in the aside only when !useIsPhone(). The SSR default is desktop.
- There is never more than one #c-name.
- Keyboard handling comes from Dialog's --kb-inset.
- Share and copy:
- share-button.tsx: return silently on AbortError; a copy fallback with toast('Link copied'); variant 'icon' (a 44px circle).
- copy-address.tsx: a 44px copy button plus a 500ms long-press on the h1, which calls clipboard.writeText and shows toast('Address copied').
- F28 (P0) lazy map:
- location-map-lazy.tsx: an IntersectionObserver with rootMargin 300px mounts the next/dynamic LocationMap. Before that, a same-size placeholder shows a 'Show map' button that mounts it immediately.
- location-map.tsx: the error overlay 'Map unavailable offline'.
- Calculator and expandable:
- payment-calculator.tsx: NumberField and the select use 'text-sm pointer-coarse:text-base'. On phones, a one-line total summary sits at the top.
- expandable.tsx: 'Read more' gets py-3 -my-3.
- src/app/homes/[slug]/loading.tsx: a skeleton with the phone carousel block, the price and facts lines and the action bar; on desktop, the mosaic and sidebar.
- P1:
- listing-context-links.tsx (F44): Directions (directionsHrefs, Apple or Google by UA), Open Street View, GreatSchools links next to each assigned school with the district named, and 'Living in <Area>' via findArea(). The address links are hidden when hideAddress is set.
- src/lib/calendar.ts: buildIcs with CRLF, DTSTAMP, escaping, 75-octet folding and UTC; tested.
- add-to-calendar.tsx: a Blob 'tour.ics' (TENTATIVE) plus a Google Calendar template link, on the tour success state.
- e2e:
- e2e/mobile/listing.spec.ts: geometry, markers, carousel, lightbox gestures and Back, index memory, action bar, overlay offset, footer, copy address, share AbortError, lazy map, stale guard, md–lg, landscape (tagged @landscape), axe.
- e2e/mobile/tour.spec.ts: 3-tap flow, radios, single #c-name, honest copy, privacy text, keyboard, .ics (P1). Tour rows are deleted via withDb afterwards.

ACCEPTANCE:

- On iphone13 (390x664) at /homes/<slug>:
- The first gallery slide is 390 wide, and the counter reads '1 / N'.
- The Back, Share and Save overlays are each at least 44x44.
- [data-site-header] and nav[data-tabbar] are hidden (via markers).
- The first 'main p.tabular' contains '$', and its bottom is above the action bar's top without scrolling.
- 'est. $' and '/mo' are visible in the first viewport.
- The breadcrumb is not visible.
- Gallery and lightbox:
- Swiping the gallery left makes the counter read '2 / N'.
- Tapping opens the lightbox at photo 2.
- A pinch from 80 to 240px gives a transform scale above 1.5; a double-tap toggles between 1 and at least 2.
- A touchDrag down of 160px at scale 1 closes it.
- After reopening, page.goBack() closes the lightbox while the URL stays on the listing, and reopening shows the last index.
- A pointercancel mid-gesture leaves no intermediate transform.
- Action bar:
- Save, Contact and 'Request a tour' are each at least 44px.
- It is hidden while #c-name or any text input has focus, and when #contact is in view (data-state=hidden).
- The toast from tapping Save has its bottom at or above the bar's top minus 8px.
- Scrolled to the very bottom, the footer's last line is at or above the bar's top.
- Tour sheet:
- Tapping 'Request a tour' opens a dialog within 300ms with date chips (tomorrow checked), a radiogroup of at least 9 times, and an In person/Video radiogroup; Video can be set to aria-checked='true'.
- As buyer@example.com, #c-email is prefilled, and exactly 3 taps (Request a tour, a time, Send) produce 'Request sent!'.
- The success text contains 'Mon–Sat 9am–6pm' and does not contain 'within the hour'. 'Never sold' is visible.
- document.querySelectorAll('#c-name').length is at most 1 at every step.
- With the tour sheet open and #c-email focused: after page.setViewportSize to 55% of the height, #c-email's box is fully inside the viewport. With simulateKeyboard(0.55), the dialog's --kb-inset is greater than 0 and #c-email's bottom is at most visualViewport.height.
- At 800x1000 with a fine pointer, tapping 'Request a tour' in the action bar scrolls #contact into view and focuses #c-name. No dialog opens, and there is exactly one #c-name. At 1280 the breadcrumb, the 5-tile mosaic and the sidebar ContactForm are unchanged.
- No maplibre-gl chunk request is made before the Location section is scrolled within 300px of the viewport. After scrolling there, a map canvas appears. Tapping 'Show map' before that mounts it immediately.
- With navigator.share stubbed to reject with an AbortError, tapping Share shows no 'Link copied'. Copy address shows 'Address copied'.
- Stale guard: with withDb setting last_synced_at to now() − 3h, the listing shows the stale notice and no 'Updated … ago'; with now(), it shows 'Updated' and 'from'. The test restores the data.
- On iphone13-landscape with simulateNotch({left:47, right:47, bottom:21}), the overlay Back button's left edge is at least 47px from the edge, and the action bar's buttons lie between x=47 and x=797.
- P1:
- The Directions link points to maps.apple.com with the iphone13 UA and to google.com/maps with the pixel7 UA.
- 'Open Street View' is present.
- directionsHrefs returns null for hideAddress (unit test).
- Each assigned school has a GreatSchools link.
- An area-guide link appears when findArea matches.
- The 'Add to calendar' download contains 'BEGIN:VEVENT', 'STATUS:TENTATIVE', a DTSTART ending in 'Z', and CRLF line endings.
- calendar.test.ts and pinch-math.test.ts pass. The existing accounts.spec 'tour requests reach the listing agent' and public.spec 'property page' pass unchanged. axe reports 0 serious or critical issues on the listing and on the open tour sheet on pixel7, iphone13 and iphone13-landscape.

DARK MODE (hand-off from DM):

- location-map.tsx and location-map-lazy.tsx (WP5, not WP3): keep the map theme (`useMapTheme()`: the resolved theme, light while printing) in the map effect's dependencies and call `markDrawnStyle` on each new map (print CSS keys off it), so a theme change rebuilds the map on `mapStyleUrl(theme)`, and create it on the current theme. The lazy wrapper's placeholder uses `bg-map`, and mounting it must not request the light style on a dark page (e2e/theme.spec.ts checks the listing's map).
- The photo viewer, action bar and tour sheet use `shade` for photo overlays and the tokens elsewhere. The listing page stays in the dark axe matrix, with the tour sheet open too.

ALL OF GEORGIA (hand-off from GA-A):

- The tour sheet exists only where `offersTours(listing)` is true (the firm's own listings, or `isFirmArea`). Elsewhere the action bar's primary action and the contact choice sheet say "Ask a question", the page keeps the "works mainly in Northeast Georgia" note, and there is no in-person option. `createInquiry` already turns a stray tour request into a question (`withoutTour`) and the reply names the office (`inquiryReply`).
- payment-calculator.tsx takes `insuranceRatePct` and `taxRatePct` from `financeFor(l.county)`; keep passing them (coastal insurance, metro tax fallback) and keep its note that flood cover isn't included.

## WP6 Staff on phones: lead cards and reliable lead controls (P0), dashboard shell and #10 staff pages (P1)

features: ['F33', 'F42', 'F34', 'F36']
owns: ['src/components/dashboard/dashboard-nav.tsx', 'src/app/dashboard/layout.tsx', 'src/app/dashboard/page.tsx', 'src/app/dashboard/leads/page.tsx', 'src/app/dashboard/leads/[id]/page.tsx', 'src/app/dashboard/listings/page.tsx', 'src/app/dashboard/listings/[id]/page.tsx', 'src/app/dashboard/listings/new/page.tsx', 'src/app/dashboard/users/page.tsx', 'src/app/dashboard/agents/page.tsx', 'src/app/dashboard/agents/[id]/page.tsx', 'src/app/dashboard/agents/new/page.tsx', 'src/app/dashboard/profile/page.tsx', 'src/app/dashboard/sources/page.tsx', 'src/components/dashboard/lead-controls.tsx', 'src/components/dashboard/ui.tsx', 'src/components/dashboard/listing-form.tsx', 'src/components/dashboard/agent-form.tsx', 'src/components/dashboard/lead-notes.tsx', 'src/components/dashboard/photo-manager.tsx', 'src/components/dashboard/open-house-manager.tsx', 'src/components/dashboard/listings-filter.tsx', 'src/lib/dashboard/queries.ts']
new: ['src/components/dashboard/lead-card.tsx', 'src/components/dashboard/lead-status-chips.tsx', 'src/components/dashboard/focus-scroll.tsx', 'src/components/dashboard/mobile-dashboard-bar.tsx', 'src/components/dashboard/listing-row-card.tsx', 'e2e/mobile/staff.spec.ts']

ALREADY BUILT (site review #1, before the packages; keep it):

- "All leads" on a lead's page and "Back to listings" on the listing editor and New listing page are `ReturnLink`s (44px): opened from the list they act like Back (tab, filters and scroll come back), otherwise they link to the last list seen in this tab. The leads and listings pages render `<ReturnSource>`, which remembers the list URL and marks the hand-off; the phone lead cards and ListingRowCard must stay plain links on those pages so it sees them.

STEPS:

- Set up the worktree with `scripts/mobile-worktree.sh 6` (port 3106, database adams_wp6). Start only after G0, because every owned file is a #10 path. Build on #10's /dashboard/leads/[id] and lead notes.
- P0 src/components/dashboard/lead-controls.tsx, covering every select (status, agent assignment, changeUserRole, linkAgentProfile):
- a controlled value with an optimistic update inside startTransition;
- `const res = await action(...)`, then check res.ok;
- on failure, roll back and show toast(message, {tone:'error'});
- on success, show a toast ('Status: Contacted', 'Assigned to Daniel', 'Role updated');
- selectClass becomes 'h-8 text-xs pointer-coarse:h-11 pointer-coarse:text-base' (md keeps its 16px).
  Server actions and authorization are unchanged.
- P0 src/lib/dashboard/queries.ts: getLeads gains {includeId?}, which fetches that lead regardless of the status filter, within the actor's scope, and returns it first. Add getNewLeadCount(actor), which respects actor scoping; it is used in P1.
- P0 src/app/dashboard/leads/page.tsx:
- In the phone variant render <LeadCard> per lead; the Table stays in the wide variant.
- Pass includeId: focus.
- The focused lead renders first with ring-2 in both layouts.
- <FocusScroll id> (focus-scroll.tsx) calls scrollIntoView({block:'center'}) after mount.
- P0 cards and chips:
- lead-card.tsx implements F33, using telHref, smsHref and mailtoHref from src/lib/deeplinks.ts. It has 44px Call/Text/Email buttons, an expandable 3-line message, a link to /dashboard/leads/[id], and the admin agent select.
- lead-status-chips.tsx: 44px chips with aria-pressed, an optimistic update, and toast('Marked contacted', {action: Undo → previous status}). The card dims until the next navigation, and failures roll back.
- P1 shell:
- dashboard-nav.tsx: below lg, hide the top strip and render <MobileDashboardBar> (data-bottom-bar='staff', data-own-chrome='bottom', pb-safe, 4 items with a Leads badge; More is a Dialog sheet whose links use navigateFromDialog). Keep the lg+ sidebar and #10's items.
- dashboard/layout.tsx: pass getNewLeadCount(actor) to the nav. main relies on the foundation's --bottom-chrome-h padding.
- P1 overview and listings:
- dashboard/page.tsx: stats in 'grid-cols-2 gap-3' below sm, using a compact StatCard added in ui.tsx; 'Needs reply' LeadCards first on phones.
- dashboard/listings/page.tsx: <ListingRowCard> in the phone variant (thumbnail, address, status chip, price, saves and leads), opening the editor when editable and the public page otherwise. Desktop tables are unchanged.
- P1 sweep of #10 staff pages (agents list, new and [id], profile, listings/new and [id], leads/[id], sources, plus agent-form, listing-form, photo-manager, open-house-manager, lead-notes and listings-filter):
- no overflow;
- 44px targets and 16px controls (mostly via the foundation);
- sticky editor save bars use bottom-[var(--bottom-chrome-h)], so they sit above the staff bar, with pb-safe;
- the editor 'Back to listings' link is 44px.
- P2:
- users/page.tsx: cards in the phone variant. Demoting an agent requires a confirmation Dialog ('Remove {name}'s agent access? Their listings and leads will be unassigned.') before changeUserRole.
- listing-form.tsx: after a failed save, focus and scrollIntoView the first aria-invalid field, with scroll-margin that clears both bars.
- e2e/mobile/staff.spec.ts, as daniel@adamsrealty.example (and admin@ for the selects): lead cards and hrefs, the focus deep link, status chips with persistence (reverted via withDb), offline rollback, select sizes and toasts, the bar, More-sheet history (P1), and a sweep of the dashboard routes (tagged @landscape) with axe.

ACCEPTANCE:

- P0: signed in as daniel on pixel7 and iphone13, /dashboard/leads renders no visible table. Each lead card has:
- Call, Text and Email links, each at least 44x44, with hrefs starting 'tel:+1', 'sms:+1' and 'mailto:' respectively; the sms body contains 'Adams Realty';
- the lead's name, type and relative time;
- a link to /dashboard/leads/<id>.
- P0: /dashboard/leads?status=contacted&focus=<id of a 'new' lead> renders that lead first with the ring, and after load its bounding box is inside the viewport. The same holds at 1280 for the highlighted table row.
- P0: tapping 'Contacted' on a card shows the new state within 100ms and a toast with 'Undo', and the change persists after reload (checked with withDb, then reverted by the test). With the network offline, the chip rolls back to the original value and an error toast appears.
- P0: every lead-controls select (status, agent, role, profile link) on coarse pointers computes a font-size of at least 16px and a height of at least 44px. A forced action failure (offline) resets the select to its previous value and shows an error toast; a success shows a toast. At 1280 with a fine pointer they keep h-8 text-xs. The existing 'admins cannot change their own role' and 'agents see only their own listings' tests pass unchanged.
- P1: below lg a fixed dashboard bar with Overview, Leads, Listings and More is visible and site nav[data-tabbar] is hidden. The Leads badge equals getNewLeadCount for daniel. More opens a sheet; tapping Profile navigates, and one page.goBack() returns to the originating dashboard page.
- P1: /dashboard, /dashboard/leads, /dashboard/leads/<id>, /dashboard/listings, /dashboard/listings/<id>, /dashboard/agents and /dashboard/profile show:
- no horizontal overflow on pixel7, iphone13, iphone13-landscape and ipad-mini;
- the editor's sticky save bar bottom at or above the dashboard bar's top;
- axe with 0 serious or critical issues.
- P1: on iphone13, the overview stats render as 2 columns, and 'Needs reply' cards come before the stats.
- P2: demoting an agent shows the confirmation dialog, and cancelling leaves the role unchanged. A failed listing save focuses the first aria-invalid field, and that field is fully visible above both bars.
- At 1280 the dashboard tables and sidebar are unchanged. dashboard.spec and accounts.spec pass unchanged. Lint, typecheck and unit tests, including #10's dashboard tests, pass.

DARK MODE (hand-off from DM):

- Lead cards, status chips, the dashboard bar and the More sheet follow the tokens (`bg-surface` cards, `text-on-ink` on any solid `bg-ink`, `bg-primary` for primary actions). Keep the renames already in leads/page.tsx, listings-filter, photo-manager, agent-form and open-house-manager.
- /dashboard, /dashboard/leads and /dashboard/listings are in the dark axe matrix, signed in as staff; keep them green and add the staff pages you redesign. Remove the `target-size` entry for the wide leads table from e2e/mobile/axe-allowlist.ts when the table's contact links are fixed.
