/*
 * ============================================================================
 * DRAFT — REQUIRES REVIEW BY ADAMS REALTY'S ATTORNEY BEFORE LAUNCH.
 * ============================================================================
 * These terms were drafted to match what this site actually does (IDX listing
 * display, accounts, saved homes and searches, lead forms, the monthly cost
 * calculator in src/components/listings/payment-calculator.tsx). They are not
 * legal advice. Counsel must review them before publishing — in particular the
 * brokerage-relationship language, the liability cap, the venue clause and the
 * IDX wording, which must match each MLS's current IDX rules exactly.
 * Update LAST_UPDATED on every change.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { formatLongDate, mailtoHref } from "@/components/content/contact";
import { ContactMethods } from "@/components/content/contact-methods";
import { KeyPoints, LegalLayout, LegalSection, type TocItem } from "@/components/content/legal";
import { PageIntro } from "@/components/content/page-intro";
import { site } from "@/config/site";

/** Change whenever the terms change. */
const LAST_UPDATED = "2026-09-25";

export const metadata: Metadata = {
  title: "Terms of use",
  description: `The terms for using the ${site.name} website, including how listing (IDX) information and payment estimates may be used.`,
  alternates: { canonical: "/terms" },
};

const TOC: TocItem[] = [
  { id: "summary", title: "The short version" },
  { id: "agreement", title: "Agreeing to these terms" },
  { id: "about", title: "About us and this site" },
  { id: "accounts", title: "Accounts" },
  { id: "acceptable-use", title: "Acceptable use" },
  { id: "listing-information", title: "Listing information (IDX)" },
  { id: "estimates", title: "Estimates and valuations" },
  { id: "communications", title: "Messages and alerts" },
  { id: "content", title: "Our content" },
  { id: "third-party", title: "Third-party services" },
  { id: "fair-housing", title: "Fair housing" },
  { id: "no-warranty", title: "No warranties" },
  { id: "liability", title: "Limitation of liability" },
  { id: "indemnity", title: "Indemnity" },
  { id: "termination", title: "Suspending access" },
  { id: "governing-law", title: "Governing law" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact us" },
];

export default function TermsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Legal"
        title="Terms of use"
        lead={`The ground rules for using the ${site.name} website — what you can expect from us, and what we ask of you.`}
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
            <>Use the site for your own home search. Don&apos;t scrape it or resell its data.</>,
            <>
              Listing information comes from the MLS. It&apos;s deemed reliable but not guaranteed,
              so verify anything important.
            </>,
            <>
              Payment estimates and valuations are illustrations, not offers of credit or
              appraisals.
            </>,
            <>
              Browsing or contacting us doesn&apos;t make you our client. That takes a separate
              written agreement.
            </>,
            <>The site is provided as is, and our liability is limited.</>,
            <>{site.market.stateName} law governs these terms.</>,
          ]}
          footnote={<>This summary is for convenience. The full terms below are what apply.</>}
        />

        <LegalSection id="agreement" title="Agreeing to these terms">
          <p>
            These terms of use (“terms”) govern your use of this website, which is operated by{" "}
            {site.legalName} (“{site.name},” “we,” “us”). By using the site you agree to these terms
            and to our <Link href="/privacy">privacy policy</Link>. If you don&apos;t agree, please
            don&apos;t use the site.
          </p>
        </LegalSection>

        <LegalSection id="about" title="About us and this site">
          <p>
            {site.legalName} is a real estate brokerage licensed in {site.market.stateName}. This
            site lets you search homes for sale and for rent, save homes and searches, estimate
            monthly costs and contact our agents.
          </p>
          <p>
            <strong>Using the site doesn&apos;t make you our client.</strong> Browsing, creating an
            account or sending us a message doesn&apos;t create an agency or brokerage relationship
            with {site.name} or any of our agents. That relationship begins only when you sign a
            written brokerage agreement with us. Until then, please don&apos;t share information you
            need kept confidential, such as the most you&apos;d be willing to pay for a home.
          </p>
        </LegalSection>

        <LegalSection id="accounts" title="Accounts">
          <ul>
            <li>You must be at least 18 years old to create an account.</li>
            <li>Give accurate information and keep it up to date.</li>
            <li>
              Accounts are for one person. Don&apos;t share yours or create one for someone else
              without their permission.
            </li>
            <li>
              Keep your password private. You&apos;re responsible for activity under your account,
              so tell us right away if you think someone else has used it.
            </li>
            <li>
              You can close your account at any time by emailing{" "}
              <a href={mailtoHref(site.email, "Close my account")}>{site.email}</a>. We may suspend
              or close accounts that break these terms.
            </li>
          </ul>
        </LegalSection>

        <LegalSection id="acceptable-use" title="Acceptable use">
          <p>Please use the site lawfully and as it&apos;s intended. You agree not to:</p>
          <ul>
            <li>
              copy, scrape, crawl or download listing data or other content in bulk, or access the
              site with bots or other automated tools — except search engines indexing public pages
              in line with our robots.txt file;
            </li>
            <li>republish, sell, license or otherwise commercially use content from the site;</li>
            <li>
              send false, misleading or spam messages, or use our forms to advertise or solicit;
            </li>
            <li>impersonate anyone or misrepresent your connection to a person or company;</li>
            <li>
              access accounts, data or areas of the site you&apos;re not authorized to use, or
              probe, scan or test its security;
            </li>
            <li>interfere with the site, including by overloading it or introducing malware; or</li>
            <li>
              use the site or its information to harass anyone, or to discriminate in violation of
              fair housing laws.
            </li>
          </ul>
        </LegalSection>

        <LegalSection id="listing-information" title="Listing information (IDX)">
          <p>
            Listings on this site come from multiple listing services (MLSs) through Internet Data
            Exchange (IDX) programs, along with homes our own agents list directly. Many listings
            are held by other brokerages, and each listing identifies the brokerage that listed it.
          </p>
          <ul>
            <li>
              <strong>Personal, non-commercial use only.</strong> IDX information is provided
              exclusively for consumers&apos; personal, non-commercial use. It may not be used for
              any purpose other than to identify properties you may be interested in buying or
              renting.
            </li>
            <li>
              <strong>Deemed reliable but not guaranteed.</strong> Listing details — including
              square footage, lot size, room counts, school assignments, taxes, HOA dues and photos
              — come from sellers, listing agents and public records. They are believed to be
              reliable but are not guaranteed and should be independently verified.
            </li>
            <li>
              <strong>Timing.</strong> Listings sync from each MLS on a regular schedule, so a home
              can sell or change between updates. Property pages show when their data was last
              updated.
            </li>
            <li>
              <strong>Ownership.</strong> Listing data belongs to the MLS and its participants and
              may be protected by copyright. Each MLS&apos;s own disclaimer appears on pages that
              show its listings.
            </li>
          </ul>
        </LegalSection>

        <LegalSection id="estimates" title="Estimates, calculators and valuations">
          <ul>
            <li>
              <strong>The monthly cost calculator</strong> and other payment estimates are for
              illustration only. They rely on assumptions — interest rate, down payment, property
              taxes, insurance, HOA dues and mortgage insurance — that may not match your situation.
              They are <strong>not an offer of credit</strong>, a loan approval or pre-approval, or
              a commitment to lend, and actual rates and payments will vary. Talk to a licensed
              mortgage lender about financing.
            </li>
            <li>
              <strong>Home valuations</strong> from our agents are opinions of value based on market
              information. They are not appraisals and shouldn&apos;t be relied on as one.
            </li>
            <li>
              <strong>Neighborhood, market and school information</strong> is general and may be
              incomplete or out of date. School assignments can change, so confirm them with the
              school district.
            </li>
          </ul>
        </LegalSection>

        <LegalSection id="communications" title="Messages and alerts">
          <p>
            When you send a message or request through the site, you agree that {site.name} may
            contact you by email or phone about that request. Alerts you sign up for arrive by email
            and can be turned off at any time with the link in each alert or in your account
            settings.
          </p>
          <p>
            Please don&apos;t send sensitive information, such as Social Security or bank account
            numbers, through our forms.
          </p>
        </LegalSection>

        <LegalSection id="content" title="Our content and trademarks">
          <p>
            The site&apos;s design, text, graphics and software, and the {site.name} name and logo,
            belong to {site.legalName} or its licensors. Listing data and photos belong to the MLS,
            its participants or the photographers who took them. You may view and print pages for
            your own personal use; any other use needs our written permission.
          </p>
        </LegalSection>

        <LegalSection id="third-party" title="Third-party services and links">
          <p>
            The site uses and links to services run by others, such as map providers, virtual tours
            and other websites. We don&apos;t control them and aren&apos;t responsible for their
            content, availability or privacy practices. Your use of them is governed by their own
            terms.
          </p>
        </LegalSection>

        <LegalSection id="fair-housing" title="Fair housing">
          <p>
            {site.name} is committed to equal housing opportunity and complies with the federal Fair
            Housing Act and the Georgia Fair Housing Act. Read our{" "}
            <Link href="/fair-housing">fair housing statement</Link>.
          </p>
        </LegalSection>

        <LegalSection id="no-warranty" title="No warranties">
          <p>
            The site and all information on it are provided “as is” and “as available.” To the
            fullest extent permitted by law, {site.legalName} disclaims all warranties, express or
            implied, including warranties of merchantability, fitness for a particular purpose,
            accuracy and non-infringement. We don&apos;t promise that the site will always be
            available or error-free, or that any home shown will be available.
          </p>
          <p>
            Nothing on this site is legal, tax, financial or inspection advice. Talk to qualified
            professionals before making decisions.
          </p>
        </LegalSection>

        <LegalSection id="liability" title="Limitation of liability">
          <p>
            To the fullest extent permitted by law, {site.legalName} and its brokers, agents,
            employees and service providers will not be liable for any indirect, incidental,
            special, consequential or punitive damages, or for lost profits, data or opportunities,
            arising from your use of — or inability to use — the site or any information on it, even
            if we were told such damages were possible.
          </p>
          <p>
            Our total liability for any claim relating to the site is limited to one hundred dollars
            ($100). Some jurisdictions don&apos;t allow certain limitations, so some of these may
            not apply to you. These limits don&apos;t change any rights or obligations under a
            separate written brokerage agreement you sign with us.
          </p>
        </LegalSection>

        <LegalSection id="indemnity" title="Indemnity">
          <p>
            If you misuse the site or break these terms and someone brings a claim against us as a
            result, you agree to cover our reasonable losses and costs, including attorneys&apos;
            fees, to the extent the law allows.
          </p>
        </LegalSection>

        <LegalSection id="termination" title="Suspending access">
          <p>
            We may suspend or end your access to the site, or change or discontinue any part of it,
            at any time — for example, if you break these terms. Sections that by their nature
            should continue (such as the listing-data restrictions, disclaimers, limitation of
            liability and governing law) still apply afterward.
          </p>
        </LegalSection>

        <LegalSection id="governing-law" title="Governing law and disputes">
          <p>
            These terms are governed by the laws of the State of {site.market.stateName}, without
            regard to its conflict-of-law rules. Any dispute relating to the site or these terms
            will be brought only in the state or federal courts located in {site.market.stateName},
            and you and we consent to their jurisdiction.
          </p>
          <p>
            If any part of these terms is found unenforceable, the rest remains in effect. If we
            don&apos;t enforce a provision, that isn&apos;t a waiver of it.
          </p>
        </LegalSection>

        <LegalSection id="changes" title="Changes to these terms">
          <p>
            We may update these terms from time to time. We&apos;ll post the new version here and
            update the “Last updated” date. If you keep using the site after a change takes effect,
            you accept the updated terms.
          </p>
        </LegalSection>

        <LegalSection
          id="contact"
          title="Contact us"
          after={<ContactMethods subject="Terms of use" only={["email", "phone", "office"]} />}
        >
          <p>Questions about these terms? Get in touch.</p>
        </LegalSection>
      </LegalLayout>
    </>
  );
}
