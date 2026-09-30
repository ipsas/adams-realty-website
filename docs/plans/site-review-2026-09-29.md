# adamsrealtyga.com: site review, 29 Sep 2026

Five reviewers tested the live site: a buyer on a phone, a buyer on a computer, the broker dashboard, a comparison with competitors, and a technical check. This page combines what they found, removes duplicates and puts the problems in order of value to the business: buyers finding and contacting Adams Realty, Andrea handling leads fast, and trust and compliance.

**About the Back button problem you noticed:** all four reviewers who tested it got the same result. It is already queued for this week. It is #1 below because the queued fix needs to cover more than just the scroll position.

Items that are already planned are left out, unless a reviewer showed they are more urgent than planned. Those are marked **"Already planned, but move it up."**

---

## Top 10

### 1. Going Back from a home loses your place, and a home's page has no "Back to results" button

**Already planned, but move it up and make it bigger.**

- **What's wrong:** A buyer scrolls down the results, opens a home, then goes Back, and the list jumps to the top. Reviewers saw 3,600px down become 0 on a Pixel phone, and the same thing on an iPhone and on desktop. A few other things go wrong on the same trip:
  - If they opened the home from the map, Back shows the list instead of the map.
  - If the photo viewer is open, Back leaves the home entirely.
  - Every price or bedroom tap adds its own Back step, so getting out of a search takes several Backs.
  - The only link on a home's page is a tiny "Homes" link. It starts a new, empty search and throws away the town and filters.
  - A signed-out buyer who taps a heart is sent to sign in, and afterwards the search is gone and the home isn't saved.
  - The dashboard has the same problem. "All leads" on a lead's page sends Andrea back to the Open tab at the top, and the listing editor has no way back at all.
- **Why it matters:** Opening a home, looking, going back and opening the next one is what buyers do most. They open 10 to 30 homes in a row. Having to find their spot every time is the most tiring thing on the site, and it sends people to Zillow, which returns you to the exact card you tapped.
- **The fix:**
  1. When someone opens a home, remember how far down the list they were, which home they tapped, and whether they were on the map or the list. Put all of it back when they return, and briefly outline the home they just looked at.
  2. Put a clear **"‹ Back to results"** button at the top left of every home's page. If the buyer came from a search, it works like Back. If they came from a shared link, it goes to their last search. The site already remembers the last search, so this part is small.
  3. Make Back close the photo viewer first, on phones and computers.
  4. Make filter taps replace the current Back step instead of adding new ones.
  5. Keep the full search in the sign-in link when someone taps a heart, and save that home automatically after sign-in.
  6. Use the same approach for "All leads" in the dashboard, and add "Back to listings" to the listing editor.
  7. Add an automatic test: scroll to the 10th card, open it, press Back, and check you land on the same card, on a phone and a computer.
- **Effort:** Medium. Parts 1 and 2 are the heart of it and are fairly small.
- **Needs you?** No.

### 2. The "Request a tour" and call buttons on a home's page can lose leads on phones

**Partly planned (WP5), but move it up.** A buyer can currently believe they asked for a tour when nothing was sent.

- **What's wrong:**
  - The green bar at the bottom ("$333,000 · Request a tour") stays on screen while the buyer fills in the tour form, and the form's own button looks almost the same ("Request tour"). If the buyer taps the bar instead of the form's button, nothing is sent. The page jumps up and the real Send button slides out of sight behind the bar.
  - The agent's phone number on a home's page doesn't dial when tapped. It opens the agent's profile page instead. The only tap-to-call number on the page is the office number in the footer, about 8,000px down.
- **Why it matters:** These are the two ways a phone buyer contacts Adams. A buyer who thinks they booked a tour and never hears back is lost, and may blame the office. Buyers on phones call, so every tap that doesn't dial is a missed lead.
- **The fix:** Hide the bottom bar whenever the tour form is on screen. When the bar is tapped, scroll to the form and put the cursor in Name. Rename the form's button "Send tour request". Make the agent's phone number a real tap-to-call link.
- **Effort:** Small. The phone link takes about five minutes.
- **Needs you?** No.

### 3. New-lead emails have holes, even once email sending is set up

**Not in the plan. It belongs in this week's Resend email job.**

- **What's wrong:**
  - When Andrea hands a lead to an agent, the agent isn't told.
  - When a lead goes straight to a home's listing agent, Andrea gets no copy.
  - The site doesn't wait for the email to finish sending. On Vercel (the company hosting the site), the server can shut down before the email goes out, so some alerts may silently never arrive.
  - The email's button opens the list of leads, not the lead itself, which is where the Call button is.
- **Why it matters:** Buyers usually go with the first agent who calls back. A lead that nobody hears about is lost commission, and today nobody would ever know it happened.
- **The fix:** Make the site finish sending before the server stops. Email the agent whenever a lead is assigned to them. Add a "Copy me on every new lead" switch for Andrea. Point the email button straight at the lead. Later, text alerts to agents are worth considering.
- **Effort:** Small.
- **Needs you?** Yes, one decision: should Andrea be copied on every lead?

### 4. The tour form doesn't mention the written buyer agreement that Georgia MLS rules require

**Not in the plan. This is a compliance issue.**

- **What's wrong:** Since August 2024, Georgia MLS has required agents to have a signed written agreement with a buyer before any tour, and the agreement has to say how the agent is paid. The tour form offers a tour ("often same day") but says nothing about this, so buyers find out at the door.
- **Why it matters:** It clashes with the site's main promise, honesty about cost. Competitors tell buyers up front: Zillow uses a free, 7-day, non-exclusive touring agreement, and Redfin shows its fee when you book a tour. "Often same day" also reads as a promise.
- **The fix:** Andrea decides what Adams asks buyers to sign. A short, free, non-exclusive touring agreement is common. Then add one plain sentence to the tour form, for example: "Before the tour we'll ask you to sign a short buyer agreement that says what (if anything) you'd pay us. Fees are negotiable." Link it to a short "What it costs to buy with us" page. Keep "often same day" only if it is true.
- **Effort:** Small.
- **Needs you?** Yes. Andrea chooses the agreement and approves the wording.

### 5. Searches show the wrong homes, or a dead end

**Not in the plan.**

- **What's wrong:**
  - **Hartwell:** Searching the town of Hartwell (the second button in "Popular") shows 20 homes under "Homes for sale in Hartwell", but 7 are in Lavonia or Toccoa, and the first card is a Lavonia lot. This happens because "Hartwell" also matches the Lake Hartwell guide. The suggestions also list "Lake Hartwell" three times, labelled as a neighborhood; Lake Lanier does the same.
  - **The map:** After searching Royston, zooming out still shows only Royston's homes. Dragging the map over to Hartwell says "0 results" under "Homes for sale in Royston", even though Hartwell has 13 homes for sale.
  - **No results:** A search with no results says "widen your filters", and its only button, "Clear filters", does nothing when no filters are set. There is no "see all of Georgia", no nearby towns and no alert sign-up. Cities with no homes right now, like Atlanta or Savannah, don't even appear as suggestions.
  - **Commercial and land:** The default "Homes for sale" search mixes in commercial buildings (shown with "— bd · — ba") and land, and the heading stays "Homes" even when the buyer filters to Land only.
- **Why it matters:** Buyers conclude either that the site doesn't know the area, or that nothing is for sale nearby, and both send them back to Zillow.
- **The fix:**
  - A town search shows only that town. Offer "Lake Hartwell (lake area)" as its own suggestion, shown once, and use the heading "Homes near Lake Hartwell" for it.
  - When the buyer moves the map, drop the town and show every home in view, under the heading "Homes in this map area", with a "Back to Royston" link.
  - When there are no results, hide "Clear filters" if no filters are on. Always offer "See all homes in Georgia", 2 or 3 nearby towns that have homes, and "Email me when homes list here", and move the map to the place searched.
  - Leave commercial out of the default search. Make the heading follow the filter, for example "Land for sale in Georgia".
- **Effort:** Small.
- **Needs you?** One decision: should land be included in the default search? It may be worth keeping in for this market.

### 6. The anti-scraping limit can turn away Google, real buyers and LinkedIn

**Not in the plan.**

- **What's wrong:** To protect MLS data, the site limits how many pages one internet address can open: 120 a minute, 1,500 an hour, 5,000 a day. Several things go wrong:
  - Everyone behind one address shares that allowance: the office Wi-Fi, a library or church, and phone carriers that put many customers behind one address.
  - Every map move and filter tap counts as a page.
  - Google and Bing aren't exempt. Once 30,000+ real listings are live, Google can easily pass 5,000 pages a day, get turned away, and let listings drop out of search results.
  - Links pasted into LinkedIn get no preview at all, because LinkedIn's preview robot is mistaken for a scraper.
  - Anyone who hits the limit sees a bare line of typewriter text with no logo, no Back button and no phone number, for about 3 minutes.
  - The reviewers themselves hit it several times during this review.
- **Why it matters:** A busy afternoon at the office, or an agent showing the site to a client, could lock everyone out. Losing Google traffic would be far worse.
- **The fix:**
  - Let genuine Google and Bing crawlers through, after checking it's really them.
  - Stop blocking LinkedIn's preview robot.
  - Don't count signed-in buyers and staff, since scrapers rarely log in.
  - Exempt the office's internet address.
  - Don't count the site's own map and filter refreshes as page views.
  - Replace the bare text with a friendly branded page: "One moment, please", a Try again button, a Back button and the office phone number.
  - Keep an eye on how often real visitors hit it, using the error alerts that are already queued.
- **Effort:** Small.
- **Needs you?** Only to supply the office's internet address.

### 7. Google can index the fake sample listings and fake agents right now

**Not in the plan. It is quick, and it matters before the data reset.**

- **What's wrong:** The site's list of pages for Google (the sitemap) includes 145 fictional listings and 4 fictional agents (Daniel Reyes, Priya Natarajan, Caroline Pruitt and Marcus Bell). None of these pages tell Google to stay away.
- **Why it matters:** Fake addresses, prices and agents could appear in Google under "Adams Realty" for weeks after the reset. For a licensed brokerage, that looks bad, and it could confuse real buyers.
- **The fix:** Until real MLS listings are loaded, tell Google not to index the listing, search, area and sample agent pages. On launch day, remove that and submit the sitemap in Google Search Console and Bing Webmaster Tools. It's worth checking whether Search Console is already set up.
- **Effort:** Small.
- **Needs you?** Only for Google Search Console access at launch.

### 8. Land and farm listings are treated like houses

**Only the land search filters are queued. Everything below is new, and it should ship with that work.**

- **What's wrong:**
  - The monthly cost on bare land includes home insurance for a house that doesn't exist. The 166-acre Carnesville tract shows $793 a month of it, and a 40-acre tract shows $220. It also assumes a 30-year home mortgage. Land loans are different: local Farm Credit lenders typically want 15% or more down.
  - No price per acre appears on cards or on the listing itself. Land buyers compare tracts by price per acre first.
  - The sort menu offers "Square feet" and "Price per sqft", but not acreage or price per acre.
  - Land pages say "About this home" and show "Year built —" and "Garage —".
  - The map preview for land shows "— bd · — ba · — sqft" instead of the acreage.
  - In the dashboard, lot size has to be typed in square feet, so Andrea has to multiply acres by 43,560 herself.
- **Why it matters:** Land is about 1 listing in 5 and a core part of Adams's market. Wrong numbers on land hurt trust, because the site promises an honest cost.
- **The fix:**
  - For land with no house, drop home insurance from the estimate and label it "Land loan: terms vary; check with your lender".
  - Show "$X/acre" on cards, on the listing and in area market numbers.
  - Add sorts for "Acreage (most first)" and "Price per acre".
  - Say "About this property" on land and hide the house-only rows.
  - Use "Land · X acres" everywhere, including the map preview and the planned phone map strip.
  - Give the lot-size box an Acres / Sq ft switch that starts on Acres.
- **Effort:** Small.
- **Needs you?** No.

### 9. Nothing reminds anyone to follow up on a lead

**Not in the plan.**

- **What's wrong:** A lead that has waited four days looks exactly like one that arrived a minute ago. In the sample data, a seller asking what his home is worth sat unassigned for 4 days. There are no follow-up dates, no overdue warning and no daily summary. The site doesn't even record when a lead was first contacted.
- **Why it matters:** Speed of reply is what wins buyers and listings. A seller asking for a valuation is one of the most valuable leads a brokerage gets.
- **The fix:**
  1. Put a "Needs attention" box at the top of the dashboard showing new leads older than about 2 working hours, marked in red with "Waiting 4 days", plus tours in the next 48 hours and follow-ups due today.
  2. Add a "Follow up on" date to each lead, with quick buttons: Tomorrow, In 3 days, Next week.
  3. Send a 7 a.m. email each day. Each agent gets their own overdue leads and follow-ups; Andrea gets the whole office's.
  4. Record the time each lead is first contacted, so Andrea can see each agent's average reply time.
- **Effort:** Medium. The daily email needs Resend set up first.
- **Needs you?** Yes: agree what counts as "too long" to wait.

### 10. Photos make the site slow on phones, and real MLS photos will make it much worse

**Not in the plan. It must be fixed before real listings go live.**

- **What's wrong:**
  - The search page downloads about 100 photos (roughly 3.3MB) before the buyer scrolls, because every card loads all its swipe photos, each 1,200px wide. On a weak rural signal the first photo took 66 seconds to appear.
  - On a home's page, the main photo was still a grey box after 40 seconds on a slow signal, and the Save and Request a tour buttons didn't respond for about 40 seconds.
  - The photo-shrinking code only works for the free sample photos (Unsplash). Real Georgia MLS photos will be sent at full size, often several times bigger than the samples.
  - On a good connection everything is fast: search loads in about a quarter of a second, a home in about half a second, and nothing jumps around.
- **Why it matters:** Much of Northeast Georgia has weak phone coverage, and those buyers give up. It also uses up their data plans.
- **The fix:**
  - Load only the first photo of each card, and fetch the next when the buyer swipes.
  - Cap phone photos at about 800px wide; on one test photo that cut it from 161KB to 71KB.
  - On a home's page, load the rest of the gallery and the "similar homes" photos only when needed.
  - Load the map only when the buyer scrolls near it. That is planned in WP5; do it sooner.
  - Before launch, send MLS photos through a service that makes smaller copies, and test it on a few real MLS photos.
- **Effort:** Small for the first two steps, medium for the MLS photo resizing.
- **Needs you?** Possibly. The photo-resizing service may carry a small monthly cost.

---

## Nice to have (roughly in order of value)

**Close calls for the top 10**

- **Lake Hartwell guide is missing two big facts.** According to the sources the competitor reviewer cited, since August 26, 2026 the Army Corps has held the lake at 656 ft, 4 ft below the old 660 ft full pool, probably for 5 to 10 years. So water depths quoted "at full pool 660" are about 4 ft less. Also, a Corps dock permit ends when a property sells, and the buyer has to apply again. Local lake brokerages already explain both. _Fix:_ add both facts, a "Today's lake level" link and the Hartwell Project Office phone number to the guide and to waterfront listings. _Small. Needs Andrea to confirm the facts._
- **The "true monthly cost" uses the seller's tax bill.** In Georgia the seller's homestead exemption and frozen taxable value end at the sale, so the buyer's bill can be higher than shown. That undercuts the site's main promise. Farms can also carry a conservation-use (CUVA) covenant, with a penalty for breaking it. _Fix:_ estimate the tax from the price and the county's tax rate, and show "Current owner paid $X; exemptions don't transfer" underneath. On farm listings, add a note about CUVA. _Medium._
- **One tap can make any shopper a full admin.** The role dropdown on Users & roles saves instantly, with no "are you sure?". One slip gives a stranger every client's contact details and the power to delete listings. _Fix:_ ask for confirmation before anyone is made an admin, and list staff separately from shoppers. _Small._
- **The "3D" tour badge leads nowhere.** Cards and a filter promise a 3D tour, but a home's page never shows the tour link, even though it is stored. _Fix:_ add a "3D tour" button on the photos and near the price. _Small._
- **Dashboard on phones (WP6). Already planned, but move it up.** Tables are cut off on phones and the lead cards have no Call button. At least WP6's first part (lead cards with Call and Text, and status buttons) should come before the later phone packages, because fast replies bring in commissions. _Large overall; the first part is medium._
- **Photos can't be uploaded, only pasted as web links.** This applies to listing photos and agent headshots. MLS homes bring their own photos, but pocket listings, rentals and headshots can't be added from a phone or computer. _Fix:_ add file storage and an "Add photos" button that opens the camera roll or computer files. _Medium, with a small storage cost._
- **"Recommended" always puts Adams's featured listings first.** That clashes with the home page's "No sponsored listings" promise; the first result for all of Georgia is a $60K lot. _Fix:_ either show Adams listings in a clearly labelled strip above the results, or make "Newest" the default order. _Small. Needs your decision._

**Buyers**

- **Satellite map.** Land, farm and lake buyers want to see aerial photos: woods versus pasture, shoreline, road access. The U.S. Geological Survey's aerial photos are free. _Medium._
- **Payment calculator.** It forgets the buyer's down payment and rate on every home, and the estimate at the top of the page doesn't update when they change the numbers. The 6.25% rate has no date, and there's no FHA, VA or USDA option, even though USDA and VA loans are common around Royston. _Medium._
- **Footer shortcuts ("Open houses", "New construction", "Our listings") land on "Homes for sale in Georgia" with no explanation.** Open houses shows 0 results with "widen your filters". _Fix:_ make the heading describe the filters, and say plainly "No open houses scheduled this week". _Small._
- **Parcel ID with a link to the county's parcel site** (qPublic for Hart, Franklin and Madison). Land buyers want lot lines and tax records. _Small. First check that Georgia MLS rules allow showing it._
- **"Check internet at this address" link** to the FCC broadband map. Internet access decides purchases for rural buyers who work from home. _Small._
- **"Check USDA loan eligibility" link** to the official USDA map, for no-down-payment loans. _Small._
- **Saved homes:** share with a partner, compare homes side by side, and see them on a map. Most people buy as a couple. _Medium, needs Resend._
- **History of relisted homes.** When a slow listing is pulled and relisted, its earlier price cuts disappear. _Medium. First check what Georgia MLS rules allow._
- **Draw your own search area on the map**, for example along a highway. Best done after the phone map work in WP3. _Medium._
- **Home page:**
  - Hide the "Open houses this week: 0" tile when there are none.
  - Shorten the search box hint that gets cut off on phones.
  - Darken the photo behind the hero text so it's easier to read.
  - Replace the hero photo. It shows a Mediterranean villa with construction cranes, not Georgia. _Small. Needs you to pick a photo._
- **Small laptops (1280x720):** only about 2 homes fit on screen, and a home's key facts are below the fold. _Small._
- **Wording:** "50 days on Adams Realty" appears even on other brokers' listings; say "50 days on market". Sold homes' browser tab titles show the old list price instead of the sold price. _Small._
- **"Area guides" and "All towns"** overlap, and they disagree on the total (132 vs 112 homes). _Small._
- **"Page not found" is a blank white screen** until the site's code loads. Once real data is live, sold homes will send people there often. _Fix:_ show a proper page, and for sold homes say "This home is no longer available" with similar nearby homes. _Small._

**Sellers**

- **The Sell page shows no proof** that Adams sells homes well: no recent sales, no reviews and no named agent. Add those, plus a simple "what would I walk away with" calculator. _Small. Needs your content (sales, quotes, Andrea's photo)._
- **Per-listing report for sellers:** views, saves and inquiries for each listing, with an "Email report to seller" button. _Medium._
- **Opt-in monthly "homes sold near you" email** for homeowners. _Medium, needs Resend._

**Andrea and the agents**

- **Add a lead by hand**, for leads from phone calls, sign calls, walk-ins and referrals. _Small._
- **Tours:** add a Tours tab, "Confirm this time" and "Suggest another time" buttons, "Add to my calendar" for agents, and a red flag on tours that have passed while the lead is still New. _Medium._
- **Leads list:** add search by name or phone, filters by agent and by type, merge repeat requests from the same person, and show "Showing 200 of 340". Today the list quietly stops at 200. _Medium._
- **Shoppers who sign up and save homes never show up as leads.** Showing them to staff needs an opt-in checkbox and a privacy-policy update first. _Medium. Needs your approval of the policy change._
- **Lead statuses:** add "Won", "Lost" and "Not ready yet", so Andrea can see how many leads became clients. _Small._
- **Overview's "Active listings" number doesn't match the Listings page**, because Overview includes coming-soon homes. _Small._
- **"Invite to sign in" button for new agents**, instead of today's three separate steps. _Medium._
- **The MLS feeds page is written for a programmer.** Lead with one plain line such as "Georgia MLS: connected · last updated today 5 AM". _Small._
- **"Delete listing" sits right next to "Save changes"**, and deleting is permanent. Move it to the bottom and suggest "Mark as Withdrawn" instead. _Small._

**Behind the scenes**

- **Every page is rebuilt from the database on every visit**, even the privacy policy, and browsers are told never to keep a copy. That makes pages slower, puts more load on the database and makes Back slower. _Fix:_ serve public pages from Vercel's cache and fill in the signed-in parts afterwards. _Medium._
- **Share previews:** the home page, Sell, About and other pages show no picture when shared on Facebook or by text, and listing blurbs are cut off mid-word. _Fix:_ add one branded share image, and cut descriptions at a whole word. _Small._
- **Tell Google who the business is:** name, Royston address, phone and hours, for local search results. Also add the missing "main address" tags to four kinds of pages, and label land as land, not "House", in the data given to Google. _Small._
- **Accessibility fixes:** make card photo strips usable with a keyboard, fix how screen readers read the fact boxes, and mark the main content on the search page. _Small._
- **The heading font is heavy (118KB)** and makes the home page heading jump when it arrives. _Small._
- **Add a Content-Security-Policy**, an extra safeguard against harmful text in a listing or bio. _Medium._
- **Weekly check for broken listing photos** once real MLS data is live. _Small._

**Left out because they're already planned and nobody showed they're more urgent:**

- Hidden arrow buttons on card photos that catch taps (WP3 F15)
- Buttons smaller than a fingertip (F34)
- The search screen spending 40% of the phone on controls (WP3 and WP4)
- A shorter home page (F10)

---

## Things we checked that are fine

- **Speed on a good connection:** search loads in about a quarter of a second, a home in about half a second, and desktop is fast on every page. Nothing jumps around while pages load.
- **Phones:** swiping photos works, and the photo viewer, filter sheets and "More filters" screen all work well. Form fields are the right size and don't make the iPhone zoom in. Dark mode looks finished everywhere.
- **Buyer pages:** the filters, price history, schools, area guides and agent pages all work well, and the contact card stays in view as you scroll on desktop.
- **Dashboard:**
  - A lead's page has big Call, Text and Email buttons, private notes and the person's other requests.
  - The leads spreadsheet export is good.
  - Open houses can be scheduled from a listing, and deleting anything always asks first.
  - The phone's own Back button returns to the right spot in dashboard lists.
- **Search engines:** titles, descriptions and sitemaps are in place. Sign-in is hidden from Google. Listing data is set up for Google. http, www and trailing-slash web addresses all redirect correctly.
- **Security:** the important protections are in place (forced HTTPS, no framing by other sites and so on), and the automatic nightly jobs are password-protected.
- **Links and images:** none of 271 internal links are broken. The only broken image is one known sample photo, which disappears with the reset.
- **Color contrast** passes in both light and dark mode.
- **Sharing listings:** listing links show the photo, address and price on Facebook, iMessage, WhatsApp, Slack and X. LinkedIn is the exception; see #6.

## What we couldn't test

- **Saving homes while signed in on the live site.** The reviewers don't type passwords into the live site. The dashboard review used the local copy on this computer, which may be slightly ahead of the live site.
- **Listings outside Northeast Georgia.** The sample data covers only 17 towns (112 homes), so Savannah, Atlanta, Macon, Athens and Augusta return nothing. Check again after the data reset.
- **Real-visitor speed data from Google.** The site is too new to have any yet.
- **Zillow, Realtor.com, Homes.com and LandWatch pages.** Those sites block automated visits, so the comparison relied on their help pages and news coverage. Redfin was checked directly.

Evidence (scripts and screenshots) is in `C:\Users\benan\AppData\Local\Temp\claude\C--Dev\d8bbeaa2-e03d-4d9a-8e30-6bb1f4b74579\scratchpad\review\`, in the folders phone-buyer, desktop-buyer, broker-dashboard, competitors and technical.
