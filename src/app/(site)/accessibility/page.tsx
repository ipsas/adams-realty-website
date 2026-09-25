import type { Metadata } from "next";
import Link from "next/link";
import { formatLongDate, telHref } from "@/components/content/contact";
import { ContactMethods } from "@/components/content/contact-methods";
import { LegalLayout, LegalSection, type TocItem } from "@/components/content/legal";
import { PageIntro } from "@/components/content/page-intro";
import { site } from "@/config/site";

/*
 * Keep "How we build for accessibility" limited to things the code really
 * does (skip link in src/app/layout.tsx, focus styles in globals.css, labeled
 * fields in src/components/ui/form.tsx, plain-text email parts, the list view
 * that mirrors every map search). Update LAST_REVIEWED when this page changes.
 */

const LAST_REVIEWED = "2026-09-25";

export const metadata: Metadata = {
  title: "Accessibility",
  description: `${site.name} is committed to an accessible website for everyone. Our WCAG 2.2 AA goal, known limitations, and how to get help or report a problem.`,
  alternates: { canonical: "/accessibility" },
};

const TOC: TocItem[] = [
  { id: "get-help", title: "Need help right now?" },
  { id: "commitment", title: "Our commitment" },
  { id: "what-we-do", title: "How we build for accessibility" },
  { id: "limitations", title: "Known limitations" },
  { id: "accommodations", title: "Accommodations" },
  { id: "report", title: "Report a problem" },
  { id: "ongoing", title: "Ongoing work" },
];

export default function AccessibilityPage() {
  return (
    <>
      <PageIntro
        eyebrow="Accessibility"
        title="A home search that works for everyone"
        lead={`Everyone should be able to find a home, learn about it and reach our agents — including people who use screen readers, keyboards, voice control, magnification or other assistive technology.`}
        meta={
          <>
            Last reviewed <time dateTime={LAST_REVIEWED}>{formatLongDate(LAST_REVIEWED)}</time>
          </>
        }
      />

      <LegalLayout toc={TOC}>
        <section
          id="get-help"
          aria-labelledby="get-help-heading"
          className="scroll-mt-24 rounded-3xl bg-brand-50 p-6 ring-1 ring-brand-100 sm:p-8"
        >
          <h2
            id="get-help-heading"
            className="font-display-tight text-2xl font-medium text-ink sm:text-[1.75rem]"
          >
            Need help right now?
          </h2>
          <p className="mt-3 leading-relaxed text-ink-soft">
            Call{site.hours ? ` (${site.hours})` : ""} or email, and a person on our team will help
            you search for homes, read listing details or schedule a tour. If you&apos;re deaf, hard
            of hearing or have a speech disability, you can reach us through your preferred relay
            service, or by dialing{" "}
            <a
              href={telHref("711")}
              className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-600"
            >
              711
            </a>
            .
          </p>
          <ContactMethods subject="Accessibility help" only={["phone", "email"]} className="mt-6" />
        </section>

        <LegalSection id="commitment" title="Our commitment">
          <p>
            {site.legalName} wants this website to be usable by as many people as possible. We aim
            to meet the{" "}
            <a href="https://www.w3.org/TR/WCAG22/" target="_blank" rel="noreferrer">
              Web Content Accessibility Guidelines (WCAG) 2.2
            </a>{" "}
            at Level AA, the standard published by the World Wide Web Consortium (W3C), across the
            site and the emails it sends.
          </p>
          <p>
            Where we fall short, we want to know — and we&apos;ll make sure you can get the same
            information and service another way in the meantime.
          </p>
        </LegalSection>

        <LegalSection id="what-we-do" title="How we build for accessibility">
          <ul>
            <li>
              A <strong>“Skip to content”</strong> link at the top of every page lets keyboard and
              screen reader users bypass the navigation.
            </li>
            <li>
              Controls are built from standard buttons, links and form fields so they work with
              keyboards and assistive technology, and a clearly visible outline shows where keyboard
              focus is.
            </li>
            <li>
              Pages use headings and landmarks (header, navigation, main content and footer) so you
              can move around them quickly with a screen reader.
            </li>
            <li>
              Form fields are labeled for assistive technology, most have visible labels, and errors
              are explained in text, not by color alone.
            </li>
            <li>
              Text and interface colors are chosen for readable contrast, pages adapt to small
              screens and browser zoom, and we never disable pinch-to-zoom.
            </li>
            <li>
              Photos have text alternatives, and purely decorative images are hidden from screen
              readers.
            </li>
            <li>Every email we send includes a plain-text version.</li>
          </ul>
        </LegalSection>

        <LegalSection id="limitations" title="Known limitations">
          <p>We know about these gaps and have alternatives in place:</p>
          <ul>
            <li>
              <strong>Interactive maps.</strong> Moving around the map works best with a mouse or
              touch, and map pins aren&apos;t fully described to screen readers. Every map search
              has an equivalent <strong>list view</strong> with the same homes, filters, sorting and
              pages. The list is always available — on phones, use the List / Map button — and every
              property page gives the address and details in text.
            </li>
            <li>
              <strong>Listing photos and descriptions</strong> come from the MLS and listing agents,
              and photos usually aren&apos;t individually described. An agent can describe any home,
              its layout or its photos for you — just <Link href="/contact">ask</Link>.
            </li>
            <li>
              <strong>Third-party content</strong>, such as virtual tours, floor plans and documents
              hosted by others, may not meet the same standard. We&apos;ll help you get that
              information another way.
            </li>
          </ul>
        </LegalSection>

        <LegalSection id="accommodations" title="Accommodations">
          <p>
            If you have a disability and need an accommodation to use our services — for example,
            information in large print, communicating by email instead of phone, or a tour planned
            around accessibility needs — please ask. Reasonable accommodations are part of our{" "}
            <Link href="/fair-housing">fair housing commitment</Link>.
          </p>
        </LegalSection>

        <LegalSection
          id="report"
          title="Report a problem"
          after={<ContactMethods subject="Accessibility problem" only={["email", "phone"]} />}
        >
          <p>If part of the site doesn&apos;t work for you, please tell us. It helps to include:</p>
          <ul>
            <li>the address (URL) of the page;</li>
            <li>what you were trying to do, and what happened instead;</li>
            <li>
              your browser and device, and any assistive technology you use (for example, VoiceOver
              on iPhone or NVDA with Firefox).
            </li>
          </ul>
          <p>A screenshot or screen recording helps too, if that&apos;s easier for you.</p>
        </LegalSection>

        <LegalSection id="ongoing" title="Ongoing work">
          <p>
            Accessibility is part of how we design, build and review new features, not a one-time
            project. We review this statement as the site changes; it was last reviewed on{" "}
            {formatLongDate(LAST_REVIEWED)}.
          </p>
        </LegalSection>
      </LegalLayout>
    </>
  );
}
