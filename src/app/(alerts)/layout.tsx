import { telHref } from "@/components/content/contact";
import { EqualHousingLogo } from "@/components/content/equal-housing-logo";
import { LogoLockup } from "@/components/layout/logo";
import { SiteMain } from "@/components/layout/site-main";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { previewPassword } from "@/lib/preview-gate";

/**
 * The pages alert emails link to (/alerts/…). With the preview gate off they're like every
 * other page: site header, tab bar and footer.
 *
 * While the gate is on they're the one part of the site it leaves open to everyone (the
 * links must work from any mail app), so they stand alone like /preview (`standsAlone` in
 * src/lib/preview-gate.ts): no header and tab bar (SiteChrome) and no footer (here), whose
 * links lead into the site and whose towns and notices come from the sample listings. Only
 * the firm's name, phone and license, as Georgia's advertising rules ask.
 */
export default function AlertsLayout({ children }: LayoutProps<"/">) {
  if (!previewPassword()) return <SiteMain>{children}</SiteMain>;
  return (
    <>
      <header>
        <Container className="flex justify-center pt-safe-8 sm:pt-safe-10">
          <LogoLockup />
        </Container>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <Container className="flex flex-col items-center gap-2 pt-6 pb-safe-6 text-center text-xs leading-relaxed text-muted">
          <p className="flex items-center gap-2">
            <EqualHousingLogo className="size-5 shrink-0 text-ink-soft" />
            <span>
              {site.legalName}
              {site.brokerLicense && <> · GREC firm license {site.brokerLicense}</>}
            </span>
          </p>
          <p>
            <a
              href={telHref(site.phone)}
              className="inline-flex min-h-10 items-center font-medium text-ink-soft hover:text-ink sm:min-h-0"
            >
              {site.phone}
            </a>
          </p>
        </Container>
      </footer>
    </>
  );
}
