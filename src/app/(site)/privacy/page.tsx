/*
 * ============================================================================
 * DRAFT — REQUIRES REVIEW BY ADAMS REALTY'S ATTORNEY BEFORE LAUNCH.
 * ============================================================================
 * This policy was drafted from what this codebase actually does, not from a
 * template, and it is not legal advice. Before publishing, the company's
 * attorney must review and approve it. Keep it true as the code changes:
 *
 * - Accounts & sessions: Better Auth (src/lib/auth/auth.ts) — name, email,
 *   optional phone, hashed password, optional Google sign-in; sessions store
 *   IP address + user agent; httpOnly cookies, 30-day sessions, 5-minute
 *   signed cookie cache.
 * - Inquiries: src/server/actions/inquiries.ts — stores contact details,
 *   message, referer and user agent; IP used only for the in-memory rate limit.
 * - Listing data routes (proxy.ts): client IP counted in Postgres `rate_limits`
 *   (anti-scraping, required by the Georgia MLS IDX agreement), pruned after
 *   two days. Listing page views: a count per listing per day, nothing about
 *   the visitor (listing_views).
 * - Email: Resend (src/lib/email.ts); alerts have one-click unsubscribe.
 * - Map tiles: OpenFreeMap unless NEXT_PUBLIC_MAP_STYLE_URL (or, for dark mode,
 *   NEXT_PUBLIC_MAP_STYLE_DARK_URL) points elsewhere.
 * - No analytics, advertising cookies or trackers. If any are added, update
 *   the Cookies and sharing sections (and LAST_UPDATED) first.
 *
 * TODO(adams): name the hosting and database providers once chosen, and
 * confirm the retention period for inquiries with counsel.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  addressLines,
  formatLongDate,
  hasStreetAddress,
  mailtoHref,
} from "@/components/content/contact";
import { ContactMethods } from "@/components/content/contact-methods";
import { KeyPoints, LegalLayout, LegalSection, type TocItem } from "@/components/content/legal";
import { PageIntro } from "@/components/content/page-intro";
import { site } from "@/config/site";

/** Change whenever the policy text changes. */
const LAST_UPDATED = "2026-09-28";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${site.name} collects, uses and protects your information. We never sell your personal information, and there are no ads or tracking cookies on this site.`,
  alternates: { canonical: "/privacy" },
};

const TOC: TocItem[] = [
  { id: "summary", title: "The short version" },
  { id: "who-we-are", title: "Who we are" },
  { id: "information-we-collect", title: "Information we collect" },
  { id: "cookies", title: "Cookies" },
  { id: "how-we-use", title: "How we use information" },
  { id: "messages", title: "How your messages are handled" },
  { id: "sharing", title: "Service providers and sharing" },
  { id: "emails", title: "Emails we send" },
  { id: "listing-data", title: "Listing data from the MLS" },
  { id: "retention", title: "How long we keep information" },
  { id: "your-choices", title: "Your choices and rights" },
  { id: "security", title: "How we protect information" },
  { id: "children", title: "Children's privacy" },
  { id: "governing-law", title: "Georgia law" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
];

export default function PrivacyPage() {
  const email = (
    <a href={mailtoHref(site.email, "Privacy request")} className="whitespace-nowrap">
      {site.email}
    </a>
  );

  return (
    <>
      <PageIntro
        eyebrow="Legal"
        title="Privacy policy"
        lead={`What ${site.name} collects when you use this site, why, who can see it, and the choices you have — in plain English.`}
        meta={
          <>
            Last updated <time dateTime={LAST_UPDATED}>{formatLongDate(LAST_UPDATED)}</time>
          </>
        }
      />

      <LegalLayout toc={TOC}>
        <KeyPoints
          id="summary"
          points={[
            <>
              <strong className="font-semibold text-ink">We never sell your information</strong> or
              share it with agents or companies outside {site.name} for their marketing.
            </>,
            <>No ads, advertising cookies or third-party analytics trackers on this site.</>,
            <>
              Messages you send go only to the {site.name} agent handling your request and our
              brokerage staff.
            </>,
            <>We use cookies only to keep you signed in.</>,
            <>
              You can correct your details, turn off alerts at any time, and ask us to delete your
              account.
            </>,
            <>We keep what we need to help you and to meet real estate record-keeping rules.</>,
          ]}
        />

        <LegalSection id="who-we-are" title="Who we are">
          <p>
            This website is operated by {site.legalName} (“{site.name},” “we,” “us”), a real estate
            brokerage licensed in {site.market.stateName} and based{" "}
            {hasStreetAddress(site.address) ? "at" : "in"} {addressLines(site.address).join(", ")}.
            This policy explains what information the site collects, why we collect it, who can see
            it and the choices you have.
          </p>
          <p>
            It applies to this website and the emails it sends. It doesn&apos;t cover other websites
            we link to, which have their own policies.
          </p>
        </LegalSection>

        <LegalSection id="information-we-collect" title="Information we collect">
          <h3>Information you give us</h3>
          <ul>
            <li>
              <strong>Account details.</strong> To create an account we ask for your name, email
              address and a password, and you can add a phone number in your account settings. Your
              password is stored only as a salted, one-way hash by our sign-in software, so no one
              at {site.name} can see or recover it.
            </li>
            <li>
              <strong>Sign in with Google.</strong> If you choose to continue with Google, Google
              shares your name, email address and profile photo with us, along with sign-in tokens
              we store to link your Google account. We don&apos;t ask Google for your contacts,
              calendar or any other data.
            </li>
            <li>
              <strong>Messages and requests.</strong> When you ask a question, request a tour or ask
              for a home valuation, we collect your name, email address, phone number (optional),
              your message and the details of the request — such as the home or agent you contacted,
              the tour date, time and type, or the address of the property you&apos;d like valued.
              If you&apos;re signed in, we link the request to your account.
            </li>
            <li>
              <strong>Saved homes and searches.</strong> When you&apos;re signed in, we store the
              homes you save, the searches you save (the filters you chose and the name you give
              them) and how often you want alerts.
            </li>
          </ul>

          <h3>Information collected automatically</h3>
          <ul>
            <li>
              <strong>With each message you send</strong>, the address of the page you sent it from
              and your browser&apos;s “user agent” (a short description of your browser and device).
              This tells us which page you were on and helps us spot spam.
            </li>
            <li>
              <strong>When you sign in</strong>, your IP address and browser user agent are stored
              with your sign-in session to help keep your account secure.
            </li>
            <li>
              <strong>When you submit a form</strong>, your IP address is used to limit repeated
              submissions. It&apos;s held only in server memory for a 10-minute window and
              isn&apos;t saved with your message.
            </li>
            <li>
              <strong>When you search or view listings</strong>, your IP address is counted against
              request limits that protect the listing data from bulk copying, as our agreement with
              Georgia MLS requires. The counts are kept for at most a few days.
            </li>
            <li>
              <strong>Listing views.</strong> We count how many times each listing page is viewed
              each day, to share traffic figures with Georgia MLS. The count holds nothing about
              you.
            </li>
            <li>
              <strong>Server logs.</strong> Like nearly every website, our hosting provider records
              basic technical details of each request — such as IP address, page requested, time and
              browser type — for security and troubleshooting.
            </li>
          </ul>

          <h3>Information we don&apos;t collect</h3>
          <p>
            We don&apos;t use advertising or analytics trackers, we don&apos;t ask for your precise
            location, and this site never asks for payment card numbers, bank details or Social
            Security numbers.
          </p>
        </LegalSection>

        <LegalSection id="cookies" title="Cookies">
          <p>We use cookies only to keep you signed in:</p>
          <ul>
            <li>
              <strong>Session cookie.</strong> Set when you sign in and removed when you sign out.
              It&apos;s marked “httpOnly,” so scripts running on the page can&apos;t read it. A
              session lasts up to 30 days and is renewed while you use the site.
            </li>
            <li>
              <strong>Session cache cookie.</strong> A signed copy of basic session details (such as
              your name and account type) that lets pages load without checking our database every
              time. It expires after five minutes and refreshes automatically while you&apos;re
              signed in.
            </li>
          </ul>
          <p>
            If you don&apos;t sign in, we don&apos;t set cookies of our own. We don&apos;t use
            advertising cookies, analytics cookies, tracking pixels or social-media widgets, and our
            web fonts are served from our own servers rather than a third party. If we ever add
            analytics, we&apos;ll update this policy first.
          </p>
          <p>
            You can block or delete cookies in your browser settings. You&apos;ll still be able to
            browse homes, but you won&apos;t be able to sign in or save homes and searches.
          </p>
        </LegalSection>

        <LegalSection id="how-we-use" title="How we use information">
          <ul>
            <li>
              <strong>To run your account:</strong> signing you in, keeping your saved homes and
              searches, and resetting your password when you ask.
            </li>
            <li>
              <strong>To respond to you:</strong> routing your message to the right agent, arranging
              tours, preparing valuations and following up on your request.
            </li>
            <li>
              <strong>To send emails you&apos;ve asked for</strong>, such as alerts about saved
              searches and saved homes (see <a href="#emails">Emails we send</a>).
            </li>
            <li>
              <strong>To keep the site safe:</strong> preventing spam and abuse, securing accounts
              and investigating problems.
            </li>
            <li>
              <strong>To meet our legal obligations</strong>, including record-keeping rules that
              apply to real estate brokerages in {site.market.stateName}.
            </li>
          </ul>
          <p>
            We don&apos;t use your information to build advertising profiles, and we don&apos;t make
            automated decisions about you that have legal or similarly significant effects.
          </p>
        </LegalSection>

        <LegalSection id="messages" title="How your messages are handled">
          <p>
            Every question, tour request and valuation request is saved in our database and emailed
            to one place: the {site.name} listing agent for the home you asked about, the agent you
            chose, or our office inbox, where our staff assign it to one of our agents.
          </p>
          <p>
            Inside {site.name}, access is limited by role. An agent can see only the requests
            assigned to them. Our brokerage administrators can see all requests so they can route
            them and make sure none are missed. Agents may keep private notes on a request, such as
            when they called you back.
          </p>
          <p>
            <strong>We never sell, rent or trade your contact details</strong>, and we don&apos;t
            pass them to agents at other brokerages, lead-generation companies or advertisers.
          </p>
          <p>
            If you decide to buy, sell or rent with us, your agent will share the information needed
            to complete your transaction — for example with the other party&apos;s agent, a lender,
            a closing attorney or an inspector — as part of working on your behalf.
          </p>
        </LegalSection>

        <LegalSection id="sharing" title="Service providers and sharing">
          <p>
            We use a small number of companies to run the site. Those that handle personal
            information for us may use it only to provide their service to us:
          </p>
          <ul>
            <li>
              <strong>Our hosting and database providers</strong>, which run the website and store
              accounts, saved homes and searches, and messages.
            </li>
            <li>
              <strong>Resend</strong>, which delivers our email — password resets, alerts, and
              notifications to our agents about new messages. It receives each recipient&apos;s
              email address and the content of the email.
            </li>
            <li>
              <strong>Google</strong>, only if you choose to sign in with Google.
            </li>
          </ul>
          <p>
            Some content loads directly from other servers. They receive the technical details any
            website receives when your browser requests a file, such as your IP address and browser
            type, but no account information:
          </p>
          <ul>
            <li>
              <strong>Map tiles</strong> come from our map provider (currently OpenFreeMap), which
              can see the map area you&apos;re viewing.
            </li>
            <li>
              <strong>Listing photos</strong> load from the MLS or the photo services that host
              them.
            </li>
          </ul>
          <p>
            We may also disclose information when the law requires it (for example, to comply with a
            valid subpoena or court order); to protect the rights, property or safety of our
            clients, the public or {site.name}; or as part of a merger, acquisition or sale of our
            business, in which case this policy will continue to apply to your information.
          </p>
        </LegalSection>

        <LegalSection id="emails" title="Emails we send">
          <ul>
            <li>
              <strong>Account emails</strong>, such as password reset links, which expire after one
              hour.
            </li>
            <li>
              <strong>Replies to your requests</strong> from the agent handling them.
            </li>
            <li>
              <strong>Saved-search alerts</strong> with new listings and price drops, as often as
              you choose: right away, daily, weekly or never.
            </li>
            <li>
              <strong>Saved-home updates</strong> when a home you&apos;ve saved changes price or
              status. These start when you save a home, and you can turn them off in your account
              settings.
            </li>
          </ul>
          <p>
            Every alert includes a one-click unsubscribe link. The site doesn&apos;t send marketing
            newsletters, and we never sell or rent your email address.
          </p>
        </LegalSection>

        <LegalSection id="listing-data" title="Listing data from the MLS">
          <p>
            Property listings on this site come from multiple listing services (MLSs) through
            Internet Data Exchange (IDX) agreements, along with homes our own agents list directly.
            Listing information describes properties — price, features, photos and history — and the
            brokerages and agents that represent them. It isn&apos;t information about you as a
            visitor.
          </p>
          <p>
            We honor sellers&apos; choices: if a seller opts out of internet display, the listing
            isn&apos;t shown, and if a seller asks for the address to be withheld, we don&apos;t
            display it. Listings removed from an MLS feed are taken down here too. Listing data is
            provided for your personal, non-commercial use and is deemed reliable but not guaranteed
            — see our <Link href="/terms#listing-information">Terms of use</Link>.
          </p>
        </LegalSection>

        <LegalSection id="retention" title="How long we keep information">
          <ul>
            <li>
              <strong>Your account, saved homes and saved searches:</strong> for as long as you keep
              your account.
            </li>
            <li>
              <strong>Sign-in sessions:</strong> until you sign out, or 30 days without use.
            </li>
            <li>
              <strong>Messages and requests:</strong> these are business records. We keep them as
              long as needed to help you and to meet legal and regulatory record-keeping
              requirements, then delete them.
            </li>
            <li>
              <strong>Spam-protection data:</strong> held only in server memory, never in our
              database.
            </li>
            <li>
              <strong>Server logs:</strong> for a limited period set by our hosting provider.
            </li>
          </ul>
          <p>
            When we delete your account, your saved homes, saved searches and sessions are deleted
            with it. Messages you sent our agents are kept as business records but are no longer
            linked to an account. Ask us if you&apos;d like those deleted too, and we will unless
            the law requires us to keep them.
          </p>
        </LegalSection>

        <LegalSection id="your-choices" title="Your choices and rights">
          <ul>
            <li>
              <strong>See and correct your details.</strong> Your name, phone number and alert
              settings are in your <Link href="/account">account settings</Link>, and your saved
              homes and searches are on your <Link href="/saved">Saved</Link> page. To change the
              email address on your account, or to get a copy of the personal information we hold
              about you, contact us.
            </li>
            <li>
              <strong>Turn off alerts</strong> at any time with the unsubscribe link in any alert or
              in your account settings.
            </li>
            <li>
              <strong>Delete your account.</strong> Email {email} from the address on your account
              and we&apos;ll delete it within 7 days.
            </li>
            <li>
              <strong>Ask us to delete a message</strong> you sent, or to stop contacting you about
              a request.
            </li>
          </ul>
          <p>
            We may ask you to confirm a request from the email address on your account so we know
            it&apos;s really you. We won&apos;t treat you differently for making any of these
            requests.
          </p>
          <p>
            Because we don&apos;t sell personal information or use it for targeted advertising,
            there&apos;s nothing to opt out of. If your browser sends a Global Privacy Control or Do
            Not Track signal, we treat it as a request not to sell or share your information — and
            we honor it.
          </p>
        </LegalSection>

        <LegalSection id="security" title="How we protect information">
          <ul>
            <li>The site is served over encrypted (HTTPS) connections.</li>
            <li>
              Passwords are stored as salted one-way hashes, and sign-in cookies can&apos;t be read
              by scripts on the page.
            </li>
            <li>
              Password reset links expire after one hour, and resetting your password signs you out
              everywhere else.
            </li>
            <li>
              Staff access is limited by role, and sensitive staff actions, such as changing
              someone&apos;s account type, are logged.
            </li>
            <li>Forms are protected against automated spam.</li>
          </ul>
          <p>
            No system is perfectly secure. If we learn of a breach that affects your personal
            information, we&apos;ll notify you as the law requires.
          </p>
        </LegalSection>

        <LegalSection id="children" title="Children's privacy">
          <p>
            This site is meant for adults looking for a home. It isn&apos;t directed to children
            under 13, and we don&apos;t knowingly collect personal information from them. If you
            believe a child has given us personal information, contact us and we&apos;ll delete it.
          </p>
        </LegalSection>

        <LegalSection id="governing-law" title="Georgia law">
          <p>
            {site.legalName} operates in the United States, and this site is intended for people
            buying, selling or renting property in {site.market.stateName}. This policy is governed
            by the laws of the State of {site.market.stateName} and applicable U.S. federal law.
          </p>
        </LegalSection>

        <LegalSection id="changes" title="Changes to this policy">
          <p>
            We&apos;ll update this page when our practices change and revise the “Last updated” date
            at the top. If a change materially affects how we use information we already have,
            we&apos;ll tell you by email or with a notice on the site before it takes effect.
          </p>
        </LegalSection>

        <LegalSection
          id="contact"
          title="Contact us"
          after={<ContactMethods subject="Privacy request" only={["email", "phone", "office"]} />}
        >
          <p>
            Questions or requests about your privacy? Contact us and mention “Privacy request” so it
            reaches the right person.
          </p>
        </LegalSection>
      </LegalLayout>
    </>
  );
}
