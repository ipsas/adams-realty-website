# Mobile contracts

The detail behind ARCHITECTURE.md's "Mobile & PWA" section: the markers,
layers, selectors, storage keys and exports that the phone shell depends on.
The design is in `docs/mobile-spec/`, which assigns each feature to a work
package (WP1–WP6). Contracts nothing uses yet are marked _reserved_, with the
package that adds the first user. Like ARCHITECTURE.md, this file is
lead-owned: packages do not edit it.

## Variants and safe areas

- `phone` is `(max-width: 767.98px), (pointer: coarse) and (max-height: 500px)`.
  `wide` is `(min-width: 768px) and (min-height: 501px), (min-width: 768px) and
(pointer: fine)`. `standalone` and `not-standalone` match the installed app's
  display mode. `PHONE_QUERY` in `src/lib/use-media-query.ts` must equal the
  `phone` query; `use-media-query.test.ts` reads `globals.css` to check.
- The root layout sets `viewportFit: "cover"` and
  `interactiveWidget: "resizes-content"`. `--sai-top|right|bottom|left`
  default to `env(safe-area-inset-*)`. `pt-safe` and `pb-safe` (plus `-N`
  forms) add the inset; `pl-safe-N` and `pr-safe-N` take the larger of N and
  the inset, which is what `Container` and the header use.

## Chrome markers

Every marker is reserved: `TabBar` returns `null` until WP2, nothing renders
the others, and both bottom variables are 0 on every page.

- `data-own-chrome~="top"` hides the header on phones and zeroes
  `--top-chrome-h` (WP4's compact search bar, WP5's listing top bar).
- `data-own-chrome~="bottom"` hides the tab bar on phones (WP2's auth shell,
  WP5's action bar, WP6's staff bar).
- `data-bottom-bar` marks a page's own fixed bar below 1024px: `action` (WP5)
  and `contact` reserve 4.5rem, `staff` (WP6) 3.5rem, plus the bottom inset.
  No package produces `contact` yet. The tab bar reserves `--tabbar-h` (3.5rem;
  3rem on short landscape screens) plus the inset. `data-state="hidden"` on a
  bar stops it counting toward the overlay height.
- While a text field has focus (not checkboxes, radios, selects or other
  non-text inputs), the tab bar and `[data-hide-on-keyboard]` (WP5's action
  bar) hide, on phones and on coarse-pointer screens up to 1023px.
- `data-app-shell` (WP3's full-height /homes) drops `#main`'s bottom padding,
  stops overscroll on phones and moves MapLibre's controls clear of notches.

## Bottom variables

- `--bottom-chrome-h` is static: `#main`'s bottom padding outside the app
  shell, so the footer stays reachable and hiding a bar never shifts layout.
- `--bottom-overlay-h` is the height the visible bars cover right now, and 0
  while typing.

Non-modal overlays that float over the page sit at
`calc(var(--bottom-overlay-h) + 12px)`; today that is only the toaster. The
exceptions:

- the bars themselves, at `bottom-0`;
- the popover's bottom card (below `lg`), which is modal over its scrim at z-45,
  covers the bars on purpose and uses only the safe inset (`bottom-safe-3`);
- two bars older than the markers: the /homes List/Map toggle (`bottom-6`; the
  results list pads its own bottom, `max-lg:pb-24`, so the Georgia MLS notice
  at the end of the list is never under it) and the listing's call-to-action
  bar (`ListingCtaBar`), which pads `<main>` itself (`pb-24`) until WP5
  replaces it. It hides (`data-state="hidden"`, `inert`) while any part of
  `#contact` is on screen, so it never covers the form's Send button.

## Stacking

`globals.css` has the short version; the full order is:

| z         | Layer                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| 10 / 20   | Map overlays; local layers inside a component (sticky form footers, row links)      |
| 30        | /homes List/Map toggle and the listing's call-to-action bar; results sheet (WP3)    |
| 40        | Bottom bars (WP2, WP5, WP6); a popover panel that isn't a bottom card (`lg` and up) |
| 45        | Popover scrim and bottom card, below `lg`                                           |
| 50        | Site header, and inside it the location suggestions and the user menu's panel       |
| 60        | Full-screen search (WP4)                                                            |
| 70        | Toasts                                                                              |
| 100       | Skip link, while focused                                                            |
| top layer | Native `<dialog>`, above everything; toasts move into the open dialog               |

## One of each

e2e selectors depend on these:

- On /homes, the results count (`search-view.tsx`) is the only
  `[aria-live=polite]`. Other live regions that can appear there use
  `role="status"` without `aria-live`: the toaster, and WP1's offline banner.
- There is one Save search button, in the results header next to Sort.
- A page has at most one `ContactForm`, because it hardcodes its field ids
  (`c-name`, `c-phone`, `c-email`, `c-message`). It appears on /contact,
  /agents/[slug] and in the listing's `aside#contact`. After WP5 the listing
  renders it in the tour sheet on phones or inline otherwise, never both.
- On a listing, the first `main p.tabular` is the summary price. Nothing above
  it may be a `p.tabular`; use a `span` for counters.
- On pages that show listings, `article` means a `ListingCard`, and e2e finds
  cards with `article a`. Other listing tiles (WP3's map strip, WP2's recently
  viewed, WP1's saved rows) must not be `article`s. Pages without listings,
  such as the legal pages, may use `article` for their text.

## Device storage

`STORE_KEYS` lists every key. It lives in the React-free `src/lib/store-keys.ts`
(so the server layout's theme script can import it) and `src/lib/local-store.ts`
re-exports it; client code keeps importing it from local-store.
`src/lib/search/recent.ts` sanitizes everything it reads back (only `/homes`
hrefs, slug-shaped slugs, http(s) or root-relative photos) and writes:

- `ar:recentSearches`: at most 8, one per place and filters (map area, sort,
  page and sheet position don't count); the unfiltered `/homes` isn't listed.
- `ar:lastSearch` and the `ar_last_search` cookie: the query string without
  `?`, URI-encoded, `Path=/`, 90 days, `SameSite=Lax`, `Secure` on https, and
  deleted instead when over 1500 characters. Both keep the sheet position. The
  `/homes?source=pwa` relaunch redirect that reads the cookie is WP3's.
- `ar:recentlyViewed`: at most 20, written by `RecordView` on the listing page.

`clearRecents()` removes all three and the cookie. `ar:searchAsMove`,
`ar:installDismissedAt`, `ar:visitDays` and `ar:uid` are reserved.

sessionStorage (this tab only; `SESSION_KEYS`, read through
`browserSessionStorage()`):

- `ar:search:<path+query>`: where a results list was (F13): `{scrollTop, slug,
view, savedAt}`, keyed without the sheet position and `save=`, params sorted
  (`placeKey`), used for 30 minutes. `src/lib/search/restore.ts` sanitizes it.
- `ar:return:<scope>` (`search`, `leads`, `listings`): the one-time hand-off
  from a list to the detail page it opened (`{from, to, at}`, 5 minutes). The
  detail page takes it and stamps its own history entry (`__arReturn` in
  `history.state`, next to Next's keys), so a reload keeps "act like Back".
- `ar:list:<scope>`: the last dashboard list URL of that scope, for the return
  link's fallback (search uses `ar:lastSearch`).

`ar:theme` (dark mode) holds the appearance: the JSON string `"light"` or
`"dark"`; no key means Match my device. Only `src/lib/theme.ts` writes it
(`writeThemePref`), and the head script in `src/lib/theme-script.ts` reads it
before first paint. It is a device preference, not user data:
`clearRecents()` and `clearUserCaches()` leave it alone.

## The `view` param

The "View" amenity filter has always been `view=1` in `SearchCriteria`. The
phone results sheet (reserved, WP3) will keep its position in the same key:
`view=map` (peek) or `view=list` (full), absent for half. The values tell them
apart, and both can be present (`?q=Hartwell&view=1&view=list`):

- `parseSearchParams` turns the filter on if any `view` value is `1`.
- `parseViewParam(params.getAll("view"))` finds the sheet position.
- `setViewParam()` adds, replaces or removes only the sheet position. Never
  `set()` or `delete()` the whole key, which would drop the filter.
- `useSearchNav().update()` keeps the sheet position through filter changes,
  and `setView()` rewrites it with `history.replaceState`, without a server
  request. Until WP3's sheet, the list/map toggle below lg calls `setView("map")`
  and `setView(null)` (list), plus `setLastSearchView()`, and SearchView reads
  the mode from `useSearchParams()`.
- `update()` replaces the history entry for filter, sort, mode and map
  changes; a new place and a new page of results pass `{ push: true }`.
- Recent searches ignore the sheet position but not the filter.

## Service worker protocol

Reserved (WP1). `src/lib/pwa/protocol.ts` defines the caches (`static-v1` for
`/_next/static` and `/vendor`; `pages` and `images`, which hold one user's
data), the messages (`CACHE_PAGES`, `CLEAR_USER_DATA`), `PAGE_ALLOW` (`/`,
`/homes`, `/homes/<slug>`, `/saved`, `/agents`, `/agents/<slug>`) and
`isNeverIntercepted`: non-GET, Range and RSC requests, and the private paths in
`NEVER`. `NEVER` wins over every allow list.

`src/lib/pwa/client.ts` never throws:

- `clearUserCaches()` clears recents and the cookie, posts `CLEAR_USER_DATA`
  and deletes the `pages` and `images` caches. It leaves `ar:uid` alone.
- `prepareSignOut()` unsubscribes from push, then clears, within 1.5s. Sign-out
  must await it before `authClient.signOut()`, and the runtime must run it
  when the signed-in user no longer matches `ar:uid`. Neither is wired yet: the
  header's Sign out (WP2) and the runtime (WP1).
- `warmPages(urls)` asks the worker to cache up to 50 same-origin `PAGE_ALLOW`
  URLs, and does nothing without an active worker.

## Pending removal

Reserved (WP1). `SaveIntercept` (`save-button.tsx`) lets a saved heart call an
interceptor instead of unsaving. `SavedHomesProvider` exposes
`setLocal(id, saved)`, a client-only override, and `count`. WP1's hook will
call `setLocal(id, false)` and show "Removed from saved" with Undo for 5s,
committing when the timer ends, on unmount or on `pagehide`; Undo never touches
the server, so the saved date and note survive. Today only `/dev/primitives`
uses it, and /saved still unsaves immediately. The provider adopts the server's
IDs only when that list changes, so a failed commit must restore the heart.

## Primitives

Both are exercised on `/dev/primitives`, which is a 404 in production.

- `Dialog` (`src/components/ui/dialog.tsx`) keeps the native `<dialog>` and the
  wide-screen card. On phones, `mobile` picks `sheet` (the default; swipe its
  handle down to close), `fullscreen` or `center`. Sheets and full-screen
  dialogs end `--kb-inset` above the bottom and never extend past the top of
  the screen, so the whole dialog, header included, stays above the on-screen
  keyboard (`foundation.spec.ts` checks this). With `closeOnBack`, opening pushes a same-URL history
  entry, so Back closes the dialog. Close it with `requestClose()` and leave it
  with `navigateFromDialog(href)`, both from `useDialogControls()`, so a single
  Back returns to where the dialog opened.
- `toast(message, { action, tone, duration })` (`src/components/ui/toast.tsx`)
  shows one toast at a time. While a dialog is open the toast renders in that
  dialog's `[data-toast-slot]`, because outside it Undo would be inert.

## Themes

Every page renders in light and dark. ARCHITECTURE.md ("Themes") has the
mechanism; these are the parts other code depends on.

- **The attribute.** Match my device is no `data-theme` on `<html>`; Light and
  Dark set `data-theme="light|dark"`. The head script sets it before first
  paint and `<ThemeSync>` keeps it; nothing else writes it. Style with the
  `dark:` variant (screen only: printing is always light), never by reading the
  attribute in JS. Client widgets that need the theme in JS (maps, canvases)
  use `useClientTheme()`, or `readResolvedTheme()` when they create something
  synchronously.
- **Classes.** Use the tokens (`canvas`, `surface`, `sunken`, `ink`, `ink-soft`,
  `muted`, `line`, `primary`, …), which follow the theme. On photos, maps and
  the lightbox, overlays and gradients use `shade` (never `ink`); chips and
  buttons on photos use `bg-surface/90|95`; labels on a solid `bg-ink` use
  `text-on-ink`; the primary fill is `bg-primary hover:bg-primary-hover`; no hex
  colours in class names. `src/lib/theme-guard.test.ts` fails on a violation,
  and a reasoned exception goes in its `ALLOW_WHITE` list.
- **The switch.** `<ThemeMenuButton>` (the header's Appearance menu) is mounted
  with `hidden wide:block`; `<AppearanceControl variant="segmented">` sits in the
  phone menu, shown with `phone:`. A phone in landscape counts as a phone, so it
  gets the menu, not the button. e2e finds the control as the group named
  "Appearance" and its radios by name ("Match my device", "Light", "Dark"; on
  phones "Auto (match my device)"); `[data-appearance=segmented|list]` marks the
  variant. The control announces nothing, so /homes keeps one live region.
- **theme-color.** The layout renders a `theme-color` pair per
  `prefers-color-scheme` (`THEME_COLORS`: #fbfaf7 light, #0f1412 dark). A
  forced theme adds `meta#theme-color-override` first in `<head>`. Code that
  wants another colour for a while (WP2's hero, F49) calls
  `setChromeColor(color)` and `setChromeColor(null)` when done, which returns
  to the theme's colour; it never writes the meta tags itself. The web app
  manifest can't vary by scheme, so its colours stay light.
- **Maps.** Map styles come from `mapStyleUrl(theme)` (`map-style.ts`, re-exported
  by `map-setup.ts`). The search map keeps its overlays across a theme swap:
  `setStyle(url, { transformStyle: carryOverlays })`, with `installOverlays` on
  every `style.load` and the missing-image resolver for the pill images. The
  location map is recreated when the theme changes. Map placeholders use
  `bg-map`. `window.__searchMap` exists in development only, for e2e.
- **Tests.** Every new page joins the dark axe matrix: add it to
  `DARK_AXE_PAGES` in `e2e/theme-suite.ts` (and `DARK_AXE_PHONE_PAGES`), with the
  role that sees it; it must report 0 contrast violations, which can never be
  allowlisted. `e2e/theme-light-regression.spec.ts` holds light-mode baselines
  from before dark mode; a change meant to alter those pages updates them.

## Exports other modules rely on

Keep these when editing the files that hold them:

- `site-header.tsx`: `data-site-header`, `HeaderUser.id`.
- `saved-homes-provider.tsx`: `count`, `setLocal`.
- `search-view.tsx`: the `recordSearch` effect and the single Save search
  button.
- `params.ts`: `SORT_LABELS`, `sortLabel`, `SORT_HELP`, and `VIEW_PARAMS`,
  `ViewParam`, `parseViewParam` and `setViewParam`, which `use-search-nav.ts`
  and `recent.ts` import.
- `homes/[slug]/page.tsx`: the `RecordView` mount, "Back to results"
  (`ReturnLink scope="search"`), `data-testid="agent-phone"` (a `tel:` link) and
  the `ListingCtaBar` rules.
- `search-view.tsx`: `usePlaceRestoration` (F13) and the click-capture handler
  that saves the place and calls `markReturn`; `listing-card.tsx`: the
  `data-returned` outline.
- `return-link.tsx`: `ReturnLink` and `ReturnSource`; `saved-homes-provider.tsx`:
  `saveIntentNext` and the `?save=` effect.
- `pwa-runtime.tsx`, `install-entry.tsx`: their signatures.
- `src/lib/theme.ts` and `src/lib/theme-script.ts`: `THEME_COLORS`,
  `setChromeColor`, `readResolvedTheme`, `applyTheme`, `writeThemePref`;
  `src/components/theme/`: `ThemeMenuButton`, `AppearanceControl`,
  `useResolvedTheme`, `useClientTheme`; `map-setup.ts`: `mapStyleUrl`.
- `search-map.tsx`: `installOverlays` on `style.load`, the theme `setStyle` with
  `carryOverlays`, and the dev-only `window.__searchMap`.

Which package may edit which file is set out in `docs/mobile-spec/foundation.md`
("Ownership after the foundation"). This file is part of ARCHITECTURE.md's
contract, split out for length, so it is lead-owned like ARCHITECTURE.md: a
package that needs a contract changed sends the lead a patch and a reason.
