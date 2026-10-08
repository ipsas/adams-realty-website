## F01 [P0] Installable PWA basics

Value: Add to Home Screen gives a real icon, a standalone window and the right status bar, with no install nags.
src/app/manifest.ts sets these fields:

- id '/', start_url '/homes?source=pwa' (see F45), scope '/', display 'standalone'
- background_color and theme_color '#fbfaf7'
- launch_handler {client_mode: 'navigate-existing'}

Icons live at stable /icons/*.png URLs, generated with ImageResponse from the icon.svg geometry:

- 192 and 512 'any'
- 512 'maskable', with the glyph at 60% width
- 96 'monochrome'

Shortcuts: Search (/homes), Near me (/homes?near=1), Saved (/saved), Open houses (/homes?openHouse=1).

src/app/apple-icon.tsx renders a 180x180 opaque icon. The foundation adds these to the root metadata and viewport:

- appleWebApp {capable, title 'Adams Realty', statusBarStyle 'default'}
- the legacy apple-mobile-web-app-capable tag
- formatDetection.telephone=false
- viewportFit 'cover'
- interactiveWidget 'resizes-content'

app/icon.svg stays in place for browser tabs.

## F02 [P0] Service worker, offline saved homes and last search, per-user isolation

Value: Saved homes, recently opened listings and your last search still open on a weak suburban signal or offline. On a shared phone, one user's data is never shown to the next person.
The SW is hand-written TypeScript at src/sw/sw.ts. It is registered with new URL('../../sw/sw.ts', import.meta.url), scope '/' and updateViaCache 'none', from whenIdle(). If the Turbopack SW path fails, the documented fallback is public/sw.js. The SW calls skipWaiting and clients.claim and checks for updates on visibilitychange. Caching runs only in production builds.

Caching rules:

- /_next/static and /vendor: cache-first, LRU capped at 400 entries, never bulk-deleted.
- Navigations: network-first with navigation preload. Only these paths are cached: /, /homes/[slug], /saved, /agents, /agents/[slug], and /homes search pages (the 3 most recent query strings only). Responses must be ok, basic and not redirected.
- Asset warming: whenever the SW stores an HTML page (a navigation or a CACHE_PAGES message), it extracts that page's /_next/static script, stylesheet and modulepreload URLs, plus the first preloaded or priority photo candidate, with the pure helper src/lib/pwa/sw-assets.ts. It caches them, so a page warmed but never opened still hydrates offline with a working gallery.

Offline navigation fallback order:

1. The exact cached page.
2. For /homes?…, the most recent cached search. This covers an offline launch from start_url.
3. The anonymous /offline page, precached with credentials 'omit'.
4. An inline 503.

/offline is a static server component with a small inline <script> that lists caches.open('pages') entries by their <title>. It needs no React hydration or route chunk.

Never intercepted: non-GET, Range, RSC (_rsc and next-router-prefetch), /api, /dashboard, /account, auth pages, /alerts and /dev.

Cross-origin images: cache-first, capped at 100.

Messages:

- CACHE_PAGES warms up to 50 allowlisted same-origin URLs.
- CLEAR_USER_DATA deletes the pages and images caches.

Per-user isolation: a SHA-256 user-id marker in localStorage is compared on every load. On a mismatch, the client calls unsubscribePush(), then clearUserCaches(). Sign-out does the same (F07).

The offline banner (role=status, no aria-live) reads 'You're offline — showing saved copies'.

## F03 [P1] Install coach after value, iOS steps, permanent entry

Value: People learn they can install the app once it is useful to them, with no nag on the first visit.
beforeinstallprompt is captured at module scope and exposed through useSyncExternalStore. A non-modal card sits at bottom calc(var(--bottom-overlay-h) + 12px). It shows only when all of these hold:

- the app is not running standalone;
- the page is not in an in-app browser;
- the user has viewed 3 or more listings (recently viewed) or it is their second visit day;
- the card was not dismissed in the last 30 days.

On Android and desktop, Install calls prompt() from the tap. On iOS and iPadOS it opens a sheet: Share, then Add to Home Screen, then Add. In in-app browsers it says 'Open in Safari/Chrome to install'.

A permanent 'Install the app' row sits in the mobile menu and is hidden when standalone. navigator.storage.persist() is called after install or after the first save.

## F06 [P0] Bottom tab bar (data-driven visibility)

Value: Search, Saved, Alerts and Account are always within thumb reach, and no page ever leaves the user without navigation.
The bar is nav[data-tabbar][data-bottom-bar=tab] with aria-label 'App'. It is always rendered by the root layout and shown with phone:flex wide:hidden. It is 56px tall (48px on short landscape screens) plus pb-safe, pl-safe and pr-safe, and has viewTransitionName 'tab-bar'.

The tabs are real Links with aria-current='page':

- Search: lastSearchHref() from the foundation store, falling back to /homes.
- Saved: /saved, with a badge showing the SavedHomesProvider count. Signed out, it goes to /sign-in?next=%2Fsaved&reason=saved, which shows an explainer.
- Alerts: /saved?tab=searches. Signed out, it uses reason=alerts. Staff see Leads (/dashboard/leads) here instead. In wave 2 this tab repoints to /updates.
- Account: /account, or Sign in (/sign-in?next=<current>) when signed out.

Visibility is never decided by pathname. The bar is hidden by CSS when any element carries data-own-chrome~='bottom'; the auth shell, the listing action bar and the staff bar render that marker. It is also hidden while a text-entry control has focus; checkboxes, radios and selects do not hide it. A 404 such as /homes/does-not-exist shows both the header and the tab bar.

#main reserves --bottom-chrome-h.

## F07 [P0] Mobile header, menu sheet and sign-out

Value: Chrome is less cluttered, the menu is predictable, Back behaves, and signing out really signs this device out.
In the phone variant, the header ([data-site-header]) shows only the logo and the hamburger; Saved and Sign in live in the tab bar. The header clears the notch with pl-safe and pr-safe.

Scroll behavior: it hides when scrolling down (8px hysteresis, only past 64px) and reappears on scroll up. It stays shown while the menu is open and changes instantly under reduced motion.

The header is hidden only when a page renders data-own-chrome~='top'. The compact search bar and the listing top bar do this, and each supplies its own navigation.

The hamburger opens a Dialog sheet with closeOnBack. It contains:

- the account block;
- Buy, Rent, Sell, Agents, Saved homes, Alerts and Account, plus Dashboard for staff;
- Install the app;
- 44px Call office and Email office buttons.
  The links use navigateFromDialog(href), so one Back returns to the page the menu was opened from.

In standalone mode, non-tab routes show a 44px back chevron. The avatar trigger becomes one 44px round button.

Sign out runs in this order: await prepareSignOut() (unsubscribes this device's push subscription and clears the user caches and recents, 1.5s cap), then await authClient.signOut(), then router.replace('/'), router.refresh() and a 'Signed out' toast. It never lands on /sign-in?next=<private page>.

## F08 [P0] Saving survives sign-in

Value: Tapping the heart while signed out still saves the home after sign-in, so nothing is lost.
A signed-out heart tap pushes /sign-in?next=<current path+query plus save=<listingId>>&reason=save. The URL still matches /sign-in?next=, so the existing e2e contract holds.

After sign-in lands on next, SavedHomesProvider sees a valid uuid in save= and calls ensureSaved(listingId). ensureSaved is an idempotent insert that checks can.saveListing and that the listing exists and is not removed. The provider then marks the heart saved, shows the toast 'Saved to your homes' with a View action, and router.replace()s the URL without save=. Invalid or unknown ids are ignored.

## F09 [P1] Auth pages on phones

Value: The keyboard no longer hides the sign-in button, and users can check their password before submitting.
In the phone variant the auth shell aligns to the top (pt-6) instead of centering in 100dvh, and renders data-own-chrome='bottom'.

Form changes:

- The password field gets a 44px Show/Hide toggle with aria-pressed.
- 'Forgot?' gets a 44px hit area.
- The email field sets autoCapitalize none.
- The foundation makes inputs 16px on coarse pointers.

REASONS gains saved, alerts and tour. The saved and alerts reasons are the signed-out explainers for the tab bar, and they are required for F06's P0 AC. src/proxy.ts adds reason=saved or reason=account to its redirects. Sign-up keeps next and reason.

## F10 [P1] Home page for phones

Value: Returning shoppers pick up where they left off, and the page takes a few thumb swipes instead of 12,000px of stacked cards.
Below sm:

- The hero is shortened (min-h about 78svh) and the Popular chips are 44px.
- A client ReturningVisitor block renders only when local data exists. It holds a 'Continue your search' card and a 'Recently viewed' snap row of up to 10 snapshot tiles. Each tile shows its 'Listing by <office>' line.
- Featured, New on the market, Neighborhoods and Agents become scroll-snap rows (cards about 82% wide, overscroll-x-contain). The document never scrolls horizontally.
- Marketing-only paragraphs are hidden.

The document height on iPhone 13 is 7,500px or less. Desktop grids are unchanged.

## F11 [P0] Map with 3-detent results sheet

Value: The map and the list are visible together (the Apple Maps pattern), with search and filters in easy reach.
In the phone variant (portrait phones, iPad mini portrait and landscape phones), /homes is a non-scrolling <main data-app-shell>. Its height is calc(100dvh - var(--top-chrome-h) - var(--bottom-chrome-h)) and overscroll is none. The MapLibre map is full-bleed. The FilterBar overlay ([data-search-topbar]) sits at the top with pt-safe. The results pane is the sheet, and it is the same DOM node as the desktop list, so the list is never rendered twice.

Detents are recomputed by a ResizeObserver:

- full: just under the top bar;
- half: about 52% of the shell, or 50% when the shell is shorter than 360px;
- peek: 96px, or 72px when the shell is shorter than 360px.
  The initial detent comes from the URL: view=map gives peek, view=list gives full, and no param gives half. Detent changes update the URL with history.replaceState and make no server request.

Drag and scroll:

- Pointer Events with pointer capture. Transforms are written in rAF with no setState per move.
- The settle target projects velocity over 200ms. The settle animation is 320ms ease-out-quint, or instant under reduced motion.
- The sheet rubber-bands past full. pointercancel settles like pointerup.
- A native touchmove listener {passive:false} hands off from scrolling to dragging at scrollTop 0.
- Keyboard or screen-reader focus entering a card while the sheet is at half or peek expands it to full, so focus never lands in an overflow-hidden body.

The sheet header holds:

- the 44px handle button (aria-expanded; Enter or Space cycles the detents);
- the only aria-live='polite' element on the page ('N results');
- the Sort select;
- the single Save search button.

After the sheet settles, map.easeTo sets padding bottom to the visible sheet height and padding top to the top bar height.

In the wide variant the split layout is kept, and the list grid uses a container query (one column when the pane is under about 36rem, two above that). This keeps cards at 768–1023px about 400px wide instead of two 190px columns.

## F12 [P0] Pin tap preview strip

Value: Tap a price pin to see that home, then swipe through nearby homes without losing the map.
A single map click handler runs queryRenderedFeatures on a box of ±12px for touch or ±4px for a mouse. It checks pins-active, pins, pin-dots and clusters, in that order.

Tapping a cluster expands it. Tapping a pin on a phone does four things:

- drops the sheet to peek;
- highlights the pin;
- shows a horizontal scroll-snap strip above the sheet;
- orders the strip's cards by distance from the tapped pin (up to 40 in-bounds pins).

Strip cards are about 85vw wide and are div role='group' elements, not article elements. Each shows:

- photo;
- price and the 'est. $X/mo' line (sale listings only);
- beds, baths and sqft, or for bare land 'Land · X acres · $Y/acre' (`landSummary`; site review #8);
- address (data-testid 'preview-address');
- 'Listing by <office>' (IDX);
- a 44px plain SaveButton.

Swiping highlights the centered card's pin and pans the map when that pin is off-screen. Tapping a card opens the listing. A 44px close button, or a tap on empty map, dismisses the strip and restores the previous detent.

Desktop keeps the anchored popup, created once per click instead of three times.

## F13 [P0] Back restores exactly where you were

Value: You can browse many homes in a row without re-finding your place, which is the core phone task.
sessionStorage key ar:search:<path+query without view> stores {detent, scrollTop, selectedPinId, savedAt}.

The entry is written on card tap (capture phase), on pagehide and on visibilitychange. On mount it is restored if it is under 30 minutes old. This works for both the phone sheet body and the desktop scroller.

useSearchNav keeps the view param when filters change, so the detent survives filter changes. The map viewport comes back from bounds in the URL; without bounds, the same fitKey refits to the same results.

The last detent is also saved to local store (setLastSearchView), so a relaunch restores it (F45).

## F14 [P0] Map correctness, performance and 'Search this area'

Value: The map starts fast and correctly framed, and moving it never swaps your results unexpectedly.
Startup:

- The map is created after first paint via whenIdle(cb, {timeout: 400}). whenIdle uses requestIdleCallback where it exists; iOS Safari lacks it, so it falls back to requestAnimationFrame and then setTimeout.
- On the first non-zero ResizeObserver size, the map calls resize() and fits the results.

Controls and gestures:

- touchPitch is false.
- NavigationControl is added only for fine pointers.

Moving the map:

- On phones, search-as-you-move defaults to off (ar:searchAsMove in local store). A 44px 'Search this area' pill appears under the top bar, positioned from --top-chrome-h, after any user pan or zoom, and applies the new bounds.
- A map search drops the town (site review #5): the results are every home in view, headed 'Homes in this map area', with 'Back to <town>' from the `from` param (already built; docs/mobile-contracts.md).
- Desktop keeps the 'Search as I move the map' checkbox, on by default.
- A map error event shows the overlay 'Map unavailable offline'.
- P1: a GeolocateControl on coarse pointers runs an explicit bounds search on moveend.

## F15 [P0] Listing card touch polish

Value: Every tap gets immediate feedback, and no hover highlight is left stuck after a tap.
Behavior changes:

- Hover highlighting runs only for pointerType 'mouse'.
- Pending links get a pressed overlay (useLinkStatus, bg-ink/10), and the photo uses active:scale-[0.99].
- The heart is 44px on coarse pointers (foundation).
- On coarse pointers, a '1/5' photo count chip replaces the hover-only arrows.

Contracts kept:

- the article element and 'article a';
- the 'Save home' aria-label with aria-pressed;
- data-testid 'card-address';
- the 'Listing by' line.

## F16 [P0] All-in monthly cost on cards and preview cards

Value: You see what you would pay each month next to every price, the portals' weakest point.
Sale cards and strip cards show a muted line 'est. $3,412/mo all-in' under the price. The value comes from quickMonthlyCost({price, annualTax, hoaFee, hoaFrequency}) with site.finance defaults, and the foundation adds the needed columns to cardColumns and to MapPin.

Rentals, sold homes, land without a price and bare land show nothing (bare land's estimate has no home insurance and a land loan's terms vary, which the listing page explains; site review #8). The listing page shows the same figure as a pill linking to #costs, where the assumptions are spelled out.

The display-mode toggle, '$3.4K/mo' pins, the maxMonthly filter and the monthly sort are wave 2 (see deferred).

## F18 [P0] Compact search bar and quick chips on phones

Value: Search chrome shrinks from about 27% of the screen to one tidy row floating over the map.
In the phone variant, FilterBar renders:

- Row 1: a 44px LogoMark home link, the location pill (still the combobox 'Search by location'), and a 44px Filters button with a count badge.
- Row 2: horizontally scrolling chips for Price, Beds, Home type, Near me and Open houses.

The bar renders data-own-chrome='top', which hides the site header on phones. Its translucent blurred background is a sibling layer (an absolute inset-0 first child, with the content relative after it). No transform, filter, backdrop-filter, will-change or contain is ever set on an ancestor of LocationSearch. The bar is at most 112px tall.

It no longer renders SaveSearchButton; the foundation moved it to the results header.

The desktop bar with popovers is kept in the wide variant.

## F19 [P0] Full-screen search mode and the ghost-tap fix

Value: Typing a place is never hidden by the keyboard, and a tapped suggestion always goes where you tapped.
Ghost-tap fix: LocationSearch commits a choice in onClick. pointerdown and mousedown only call preventDefault, which keeps focus.

Full-screen mode: in the phone variant, focusing the input (in the hero, on /homes or anywhere else) sets data-search-fullscreen on the same <form>. The form becomes fixed inset-0 z-[60] bg-canvas pt-safe. The <input> is never remounted, so focus and the keyboard stay up.

The foundation CSS then:

- hides the header, the tab bar and all [data-bottom-bar];
- locks page scroll;
- neutralizes transform, filter, backdrop-filter, contain, container-type, isolation and z-index on every ancestor, so the hero's `relative isolate` or the /homes overlay can never trap the panel.

Panel contents:

- a 44px Cancel button;
- with an empty term: Buy/Rent/Sold chips (hero only), 'Use my location', up to 8 recent searches and popular areas;
- while typing: suggestions listed inline (static, overscroll-contain).

Escape or Cancel exits. The input is 16px on coarse pointers. ARIA combobox semantics are unchanged.

## F20 [P0] Filters sheet with a live result count

Value: Every filter is in one place, you see '42 homes' before committing, and one Back undoes an apply.
In the phone variant, filters open in a full-screen Dialog with closeOnBack. The draft holds every criterion except q, bounds and page. The sections are anchored so the quick chips can scroll to one:

- listing type;
- price (preset chips plus min and max);
- beds and baths;
- home type;
- status (pending off by default);
- size and lot;
- year built;
- max HOA;
- listed within;
- keywords (P1, F43);
- must-have toggle chips (48px, aria-pressed);
- sort, as a radio list with the helper 'No paid placement. Recommended shows Adams-featured homes first, then newest.'

Live count:

- A chip tap updates aria-pressed immediately.
- The 'Show N homes' label switches to 'Counting…' at once, then to the number from /api/search/count (150ms debounce, aborts stale requests, s-maxage cache).
- At 0 results the button is disabled and reads 'No matches — try widening'.

Apply calls navigateFromDialog(buildSearchHref(criteria, draft)). This pops the sheet's history entry and then pushes the new search, so exactly one Back returns to the previous search. Nothing navigates before apply. The draft survives accidental dismissal until the URL criteria change. The desktop More dialog also shows 'Show N results'.

## F21 [P0] Near me

Value: One tap shows homes and open houses around you while you drive neighborhoods on a weekend.
Three entry points call getCurrentPosition from the tap (enableHighAccuracy false, maximumAge 5 minutes, timeout 10s):

- the Near me chip;
- the 'Use my location' row;
- the /homes?near=1 shortcut, which runs once and is then replaced away.

A permissions.query pre-check shows 'Location is off — turn it on in Settings' when access is denied.

Inside Georgia, it runs update({q: undefined, bounds: boundsAround(lat, lng, accuracy > 1500 ? 5 : 2.5 miles)}). Outside Georgia, it shows the toast 'We cover Georgia — showing Metro Atlanta'.

Raw coordinates are never sent; only the rounded bounds go in the URL.

## F24 [P0] Mobile listing layout

Value: Price, all-in monthly cost, facts and address sit on the first screen under edge-to-edge photos.
In the phone variant the page provides its own chrome:

- ListingTopBar is always mounted and renders data-own-chrome='top'. It is a compact bar (Back, truncated address, plain Save) that appears once the photos scroll away, detected with an IntersectionObserver.
- ListingActionBar renders data-own-chrome='bottom'.

The gallery is a full-bleed scroll-snap strip built from the same DOM as the desktop mosaic. It has a '1 / N' counter span and 44px overlay buttons for Back, Share and Save, placed with pt-safe and pl-safe/pr-safe.

Content order:

- status pill and freshness line, using freshness(source.lastSyncedAt), with a stale notice after 2 hours;
- price, the first main p.tabular;
- the 'est. $X/mo all-in' pill, linking to #costs;
- facts row;
- h1 address with a copy button (a long-press also copies);
- the existing sections;
- similar homes as a snap row;
- 'Report a problem with this listing' (mailto).

The breadcrumb and the Share/Save row are hidden in the phone variant. The IDX 'Listed by' attribution and the disclaimer stay. There is a /homes/[slug]/loading.tsx skeleton.

## F25 [P0] Photo viewer: pinch, swipe down, grid, Back closes

Value: A photo viewer better than the portals' that keeps your place.
The existing <dialog> lightbox is kept, with an opaque bg-ink backdrop and pt-safe/pb-safe. The stage is touch-none with a pointer-gesture layer.

Gestures:

- At scale 1: horizontal paging (more than 25% of the width, or more than 0.5px/ms), or a swipe down of more than 120px closes it with a fading backdrop.
- Pinch zooms 1–4× around the midpoint, with pan clamped.
- Double-tap toggles 1× and 2.5×.

Transforms are written in rAF, and a larger srcset candidate loads above 1.5×. Neighboring photos are preloaded. Keyboard, arrow buttons and +/− buttons are kept. A Grid toggle shows 2-column thumbnails.

useDialogHistory makes Android Back and browser Back close the viewer while staying on the page. The last index is stored per slug in sessionStorage.

## F26 [P0] Sticky action bar: Save, Contact, Request a tour

Value: Save, contact and tour are always one tap away, without covering the form or the footer.
The bar is fixed at the bottom, lg:hidden, with data-bottom-bar='action', data-own-chrome='bottom' and data-hide-on-keyboard. Padding is pt-3 and pb-safe-3, plus pl-safe-4 and pr-safe-4.

It contains:

- a 44px plain Save;
- a 44px Contact button that opens a sheet: Call <agent first name> (tel:+1…), Text (sms:+1…?&body=Hi, I'm interested in <street> <url>) and Email. It uses the office number when there is no Adams agent.
- the primary button, 'Request a tour' ('Ask about this home' when sold).

The primary button opens the tour sheet only in the phone variant. In the wide variant, including 768–1023px where the form is on the page, it scrolls to #contact and focuses #c-name.

When #contact is at least 30% visible, the bar sets data-state='hidden'.

#main reserves the bar's height through --bottom-chrome-h, which is static so there is no layout shift. Toasts sit above it through --bottom-overlay-h. Removed listings have no bar.

## F27 [P0] Tour scheduler sheet

Value: A tour request takes 3 taps, and you know exactly who will answer and that your details are not sold.
'Request a tour' opens a Dialog sheet with closeOnBack and keyboard insets. ContactForm is rendered in exactly one place: in the sheet in the phone variant, and inline on the page otherwise. There is never more than one #c-name.

The sheet contains:

- A header with the agent's photo and name, or 'An Adams Realty agent', and 'Replies during business hours (Mon–Sat 9am–6pm)', taken from site.hours.
- Tour and Question tabs.
- 7 date chips at least 64px tall, with tomorrow preselected.
- A radiogroup of 44px time chips from 9 AM to 6 PM.
- An In person / Video radiogroup (aria-checked), defaulting to in person.
- Name, phone and email, prefilled when signed in. 'Add a note' is collapsed.
- The privacy line 'Goes only to <first name> at Adams Realty. Never sold or shared. No lender calls.' No consent box is pre-checked.

The submit button reads 'Send tour request for Sat, Oct 3 at 2 PM'. A signed-in buyer needs 3 taps: Request a tour, a time, Send.

The success state keeps state.message. Its reply-time copy is 'An Adams agent will reply during business hours (Mon–Sat 9am–6pm)'; the invented 'within the hour' line is removed. It also offers 'Text <agent>' and Done.

P1: 'Add to calendar' offers a TENTATIVE .ics file and a Google Calendar link.

The desktop inline form keeps its behavior, except for the honest success copy.

## F28 [P0] Lazy listing map

Value: Listings load faster because the 200KB+ map library loads only when the Location section is near.
ALREADY BUILT (site review #10): LocationMapLazy waits for an IntersectionObserver (rootMargin 300px, `MAP_NEAR_PX`) or `beforeprint` before mounting the dynamic LocationMap; before that it was a next/dynamic component with ssr:false that loaded the maplibre chunk right after hydration. WP5 adds the 'Show map' button.

Until then it shows a same-size placeholder with a 'Show map' button, which mounts the map immediately when tapped. A map error shows 'Map unavailable offline'. The release performance gate depends on this.

## F30 [P0] Saved homes, redesigned for phones

Value: Saved homes and saved searches are one tap apart, removal can be undone without losing anything, and dead listings can be cleared.
/saved has 44px segmented tabs, 'Homes (n)' and 'Searches (n)', driven by ?tab=searches.

The Homes tab has:

- A sort select (16px on coarse pointers): Recently saved, Price ↑, Price ↓, Recently changed.
- In the phone variant, compact rows at most 140px tall: 112px thumbnail, price, 'est. $X/mo', facts, address, 'Listing by <office>', a change chip ('Price cut $25K · 3d', 'Now pending', 'Sold', 'Back on market'), a note preview and a 44px heart. The desktop grid of ListingCards stays.

Removal is pending on the client. Inside /saved, every heart (row or card) goes through the foundation's SaveIntercept context:

- The row dims and shows 'Removed · Undo', with a matching toast, and no server write happens yet.
- The delete (removeSaved) is committed when the 5s timer expires, on unmount or navigation, or on pagehide.
- Undo cancels the timer, so the note, created_at (saved date and sort order) and last_notified_at are untouched.
- If the commit never runs (for example, the app is killed), the home simply stays saved.

Unavailable homes are grouped under 'No longer available (n)', with Remove buttons and Clear all.

On mount, warmPages() sends the first 50 listing URLs for offline use. The page has a loading.tsx.

## F31 [P0] Saved search rows that work on phones

Value: Alert frequency can be managed without one-word-per-line layouts or silent failures.
In the phone variant each row stacks. The name (tapping it runs the search) and the saved date span the full width. The controls row below holds:

- a full-width frequency select, 44px tall and 16px on coarse pointers (Instant, Daily digest, Weekly digest, No emails), with the helper text 'Instant alerts are checked every hour', which matches the hourly alerts cron;
- a 44px delete button.

Actions are awaited. Success shows the toast 'Alerts: Daily'. Failure resets the select and shows an error toast.

Delete is a pending removal with a 5s Undo, committed with the existing deleteSavedSearch. Undo therefore keeps the same id, createdAt and alert windows; nothing is re-created.

## F32 [P1] Private notes on saved homes

Value: Tour impressions stay with the home, a feature Zillow users lost.
Each saved row has a Note button that opens a keyboard-aware sheet with a 16px textarea (500 characters max).

setSavedNote(listingId, note) saves into the existing saved_listings.note column. It requires can.saveListing and updates only the actor's own row; a listing the actor has not saved returns an error.

The note preview shows on the row and survives reload. Because removal is deferred (F30), a note is never lost to Undo.

## F33 [P0] Leads on phones (staff HIGH items)

Value: Agents can call or text a new lead in seconds from a showing, and a notification link always opens that lead, which makes the fast-reply promise real.
In the phone variant, /dashboard/leads renders cards instead of the table. Each card shows:

- name, type badge and relative time;
- the listing link and a tour-time chip;
- a 3-line message with More;
- 44px Call (tel:+1…), Text (sms:+1… with the body 'Hi <first name>, this is <agent> from Adams Realty about <address>') and Email (mailto with subject) buttons;
- 44px status chips with an optimistic update and a 'Marked contacted · Undo' toast. The card stays, dimmed, until the next navigation.
- For admins, the agent select.
- A link to #10's /dashboard/leads/[id].

?focus=<id> behavior: getLeads fetches the focused lead even when the status tab excludes it. The lead renders first with a ring and is scrolled into view with {block: 'center'} (cards and the desktop table alike).

Every lead-controls select (status, agent, role, agent-profile link) awaits its action and checks res.ok. The value is controlled, with an optimistic update, rollback plus an error toast on failure, and a success toast ('Assigned to Emily').

Sizing: h-8 text-xs on fine pointers; pointer-coarse:h-11 pointer-coarse:text-base on touch.

Server-side authorization is untouched.

## F34 [P0] Touch and type baseline

Value: No iOS zoom on focus on any touch device, no mis-taps, and sheets that behave like an app's.
The foundation makes these changes:

- The shared control class becomes 'text-sm pointer-coarse:text-base'. The old 'sm:' breakpoint missed landscape iPhones (667–932px) and iPads, which iOS still zooms.
- On coarse pointers, buttons grow to 44px (sm and md to h-11, icon to size-11) and checkbox rows to min-h-11.
- Below the phone breakpoint, Dialog becomes a bottom sheet or full screen. It gets swipe-down to close, a 44px close button, safe-area padding, --kb-inset keyboard handling, closeOnBack, close({viaNavigation}) and navigateFromDialog.
- Popovers get a scrim that swallows the dismissing tap.
- A toast renders inside the topmost open dialog, so it is never inert, and otherwise above the bottom chrome.
- Tap highlight is removed, touch-action is set to manipulation, reduced-motion is handled, and scroll is locked while a dialog is open.

Each package applies pointer-coarse:text-base and 44px targets in the files it owns: location-search (WP4), the Sort select (WP3), payment-calculator (WP5), saved-search-row (WP1) and lead-controls (WP6). Pinch zoom is never disabled.

## F35 [P0] Instant tap feedback

Value: Every tap responds within 100ms, even on a slow network.
loading.tsx skeletons match the final layouts (CLS 0):

- /homes: lives in the (search) route group, so it never wraps /homes/[slug];
- /homes/[slug];
- /saved.

Cards get the useLinkStatus pressed overlay. Filter chips update aria-pressed synchronously. Default Link prefetch is kept, and search changes keep the isPending dimming.

## F36 [P0] Accessibility and reduced motion

Value: Usable with VoiceOver, TalkBack, larger text and reduced motion, and it protects the firm legally.
Structure:

- The results list is always in the DOM.
- /homes gets a <main> landmark; SearchView's root becomes main.
- Sheets are native <dialog> elements with focus trapping.
- The sheet handle and detents can be operated from the keyboard.
- State is conveyed with aria-current, aria-pressed and aria-checked, never color alone.

Motion is off under prefers-reduced-motion.

Contrast: --color-faint #98a19c (2.54:1) becomes #68716d (4.82:1 on canvas, 4.50:1 on sunken), and --color-brass-500 #b3843f (3.20:1) becomes #8a6a2f (4.81:1).

@axe-core/playwright checks key routes on pixel7, iphone13, iphone13-landscape and ipad-mini with 0 serious or critical violations. Anything left over is listed in e2e/mobile/axe-allowlist.ts with an owning package, which must clear it before merging.

## F40 [P0] Safe areas, landscape and the phone-shell variant

Value: The app looks right under the notch and home indicator in portrait and landscape, and landscape phones get the app layout instead of a squashed desktop split.
Safe areas:

- viewportFit 'cover' is set.
- --sai-top, --sai-right, --sai-bottom and --sai-left default to env(safe-area-inset-*). Tests override them to simulate a notch.
- Utilities: pt-safe[-N], pb-safe[-N] and bottom-safe-N add the inset; pl-safe[-N] and pr-safe[-N] take max(N, inset), so portrait is unchanged.
- Container (section.tsx) and the header use pl-safe-4 and pr-safe-4 at the base (6 at sm, 8 at lg).

Variants:

- phone = (max-width: 767.98px), (pointer: coarse) and (max-height: 500px).
- wide = (min-width: 768px) and (min-height: 501px), (min-width: 768px) and (pointer: fine).
- The two are mutually exclusive. A landscape iPhone (844x390) gets the phone shell (sheet, tab bar, carousel); iPad landscape and laptops get wide.
- The JS useIsPhone() reads the same PHONE_QUERY constant, and a unit test checks that it matches globals.css.
- On short landscape screens the tab bar is 48px.

The quality sweep runs at iPhone 13 landscape (844x390) and iPad mini (744x1133).

## F41 [P0] Chrome markers and bottom-chrome offsets

Value: Toasts, the install card and floating buttons never cover a page's primary actions, and hiding chrome can never strand a user.
Markers:

- data-own-chrome~='top' hides [data-site-header] in the phone variant and sets --top-chrome-h to 0.
- data-own-chrome~='bottom' hides the tab bar.
  The component that supplies the replacement chrome renders the marker, so a page never loses chrome before its replacement exists, whatever the merge order.

Bottom bars declare data-bottom-bar=tab|action|contact|staff. Globals map each to a height plus --sai-bottom, producing two variables:

- --bottom-chrome-h: static. It feeds #main padding-bottom on every page except the app shell, so the footer's last line is always reachable and hiding a bar never shifts layout.
- --bottom-overlay-h: dynamic. It ignores bars with data-state=hidden and drops to 0 while typing.

Toasts, the install card and bottom-anchored floating buttons are positioned at calc(var(--bottom-overlay-h) + 12px). Top-anchored overlays ('Search this area') use --top-chrome-h plus the search top bar.

## F42 [P1] Staff shell on phones

Value: The whole dashboard is usable one-handed between showings.
Below lg, /dashboard gets MobileDashboardBar: fixed, pb-safe, data-bottom-bar='staff' and data-own-chrome='bottom'. Its items are Overview, Leads (with a badge from getNewLeadCount(actor)), Listings and More. More is a sheet holding Profile, Agents, Users & roles, MLS feeds and Back to site, and its links use navigateFromDialog. The top strip is hidden.

Overview shows its stats in a 2x2 grid, with 'Needs reply' lead cards first. Listings become card rows in the phone variant.

#10's staff pages (agents, profile, the listing editor, lead detail, sources) are swept: no overflow, 44px targets, and the editor's sticky save bar sits above the staff bar. Desktop tables are unchanged.

## F43 [P1] Keyword filter and wider autocomplete

Value: Two must-match portal features: 'screened porch'-style keywords, and finding a home by MLS number or a county by name.
A new kw param is parsed and serialized, counted as an active filter and described as 'with “porch”'. query.ts matches it with searchVector @@ websearch_to_tsquery('english', kw). A Keywords input goes in the Filters sheet and the More dialog.

The new src/lib/search/suggest.ts adds, on top of the existing suggestions:

- an exact MLS # match, returned as a listing suggestion that navigates to /homes/<slug>;
- a county prefix match ('DeKalb County'); locationCondition gains a county ilike match.

/api/locations/suggest switches to suggest.ts. getLocationSuggestions in listings/queries.ts is left alone because WP1 owns that file. Subdivision and school autocomplete are wave 2.

## F44 [P1] Listing context: directions, Street View, schools and area guide

Value: Cheap interim answers to Homes.com's strongest area (neighborhood and school context) and to commute questions.
Under Location, a Directions link opens Apple Maps on iOS and macOS and Google Maps elsewhere (the other app is a secondary link). The destination is used as-is, so the device starts from the user's current location. An 'Open Street View' link uses the Google Maps pano deep link. Both are hidden when hide_address is set.

Schools:

- each assigned school links to a GreatSchools search for that school and city;
- the district is named.

When findArea(neighborhood or city) matches one of #10's area guides, a 'Living in <Area>' link goes to /areas/<slug>.

## F45 [P0] Relaunch reopens your last search

Value: Opening the installed app returns to the search and sheet position you left. Homes.com's reset on relaunch is its most-cited complaint.
recordSearch writes the cookie ar_last_search: the serialized query string including view, path=/, 90 days, SameSite=Lax, at most 1500 chars.

When /homes is requested with source=pwa and no other criteria, and the cookie exists, the server page redirects to /homes?<sanitized>. Sanitizing means parseSearchParams followed by serializeCriteria plus a valid view, so the redirect can never leave /homes and there is no flash.

Without the cookie, the default search renders. The installed app keeps its own cookie jar, so it restores its own last search.

## F46 [P0] Freshness and stale-feed guard

Value: The app tells the truth about how current the listings are.
freshness(lastSyncedAt, now) in format.ts returns {label: 'Updated 12 min ago', stale}, where stale means older than 2 hours (STALE_FEED_MS).

- Fresh: the results footer (WP3) and the listing (WP5) show 'Updated N min ago from <source>'.
- Stale or null: a notice reads 'Listing data last updated <date> — it may be out of date', and no 'Updated N min ago' claim is shown.

Claims that were dropped: 'stale actives never appear' (the purge is daily) and 'alerts within minutes' (the alerts cron runs hourly with a 30-minute settle).

## F47 [P0] IDX attribution on every new listing surface

Value: Keeps Adams Realty compliant with the MLS rules in ARCHITECTURE.md as listings appear in new places.
The listing office ('Listing by <office>') appears on these new surfaces:

- strip cards (WP3; MapPin gains listOfficeName);
- compact saved rows (WP1; cardColumns already has it);
- Recently viewed tiles (WP2; the recordView snapshot gains listOfficeName).

/homes previously had no MLS disclaimer because it is outside the (site) group. The results footer (WP3) now renders the source disclaimers and the data-updated line.

The listing page keeps its attribution block and footer disclaimer.

## F48 [P1] Refresh in the installed app

Value: Standalone mode has no reload button, so /saved gets one.
When matchMedia('(display-mode: standalone)') matches, /saved shows a 44px Refresh button that calls router.refresh() and shows a spinner. The page also refreshes automatically when it becomes visible after being hidden for 5 minutes or more.

There is no custom pull-to-refresh gesture, because it would fight the sheet and map gestures.

## F49 [P1] Status-bar color over the dark home hero

Value: The status bar matches the dark hero instead of a light strip over it.
A small client component on the home page watches the hero with an IntersectionObserver. While the hero is under the header, it sets the status-bar colour to brand-900 (#0f2a20) through `setChromeColor`, and it hands the colour back to the theme (the canvas: #fbfaf7 in light, #0f1412 in dark) when the hero leaves or on unmount. Dark mode has shipped, so the restored colour depends on the theme.
