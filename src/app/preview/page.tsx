import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ContactMethods } from "@/components/content/contact-methods";
import { EqualHousingLogo } from "@/components/content/equal-housing-logo";
import { LogoLockup } from "@/components/layout/logo";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { env } from "@/lib/env";
import {
  PREVIEW_COOKIE,
  previewNext,
  previewPassword,
  verifyPreviewToken,
} from "@/lib/preview-gate";
import { ChromeColor } from "./chrome-color";
import { UnlockForm } from "./unlock-form";

/** The page's colour, edge to edge (--color-brand-900, the same in light and dark). */
const CANVAS = "#0f2a20";

export const metadata: Metadata = {
  title: "Coming soon",
  description: `${site.legalName} in ${site.address.city}, Georgia. Our new website is coming soon; we're open as usual at ${site.phone}.`,
  robots: { index: false, follow: false },
};

/** The browser's toolbar matches the page, not the site's cream canvas (replaces the root pair). */
export const viewport: Viewport = { themeColor: CANVAS };

/**
 * The coming-soon page the preview gate (src/lib/preview-gate.ts) shows everyone
 * without the preview password. It stands alone: no site header, footer or links
 * into the site (SiteChrome leaves the chrome out here), and no database, so it
 * stays up whatever else is down. It still names the firm, its phone and its
 * GREC license, as Georgia's advertising rules ask.
 *
 * An unlocked browser goes straight on to `next` (never back here: `previewNext`), so a
 * bookmark or home-screen app saved on this page opens the site once unlocked.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const password = previewPassword();
  if (!password) redirect("/");
  const params = await searchParams;
  const next = previewNext(Array.isArray(params.next) ? params.next[0] : params.next);
  const unlocked = await verifyPreviewToken(
    (await cookies()).get(PREVIEW_COOKIE)?.value,
    password,
    env.BETTER_AUTH_SECRET,
  );
  // Not while answering its own unlock form (a server action, which re-renders this page
  // with the new cookie): the action redirects, or the form opens an /api link itself.
  if (unlocked && !(await headers()).has("next-action")) redirect(next);

  return (
    <div
      data-preview-page
      className="relative isolate flex flex-1 flex-col overflow-hidden bg-brand-900 text-white"
    >
      <ChromeColor color={CANVAS} />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_85%_-10%,rgb(200_155_90/0.16),transparent_60%),radial-gradient(40rem_24rem_at_0%_110%,rgb(47_117_88/0.35),transparent_65%)]"
      />
      <header>
        <Container className="pt-safe-6 sm:pt-safe-8">
          <LogoLockup inverse />
        </Container>
      </header>

      <main className="flex-1">
        <Container className="py-12 sm:py-16 lg:py-20">
          <div className="max-w-3xl">
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brass-400 uppercase">
              <span className="h-px w-8 bg-brass-400" />
              {site.market.region} real estate
            </p>
            <h1 className="font-display-tight text-4xl leading-[1.05] font-normal sm:text-5xl lg:text-6xl">
              Our new website is <em className="font-light text-brass-100">coming soon.</em>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/75">
              {site.legalName} is open as usual: call, email or stop by our office in{" "}
              {site.address.city}.
            </p>
          </div>

          <ContactMethods tone="dark" className="mt-10 max-w-3xl" />

          <section
            aria-labelledby="preview-heading"
            className="mt-12 max-w-md rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10 ring-inset sm:p-6"
          >
            <h2 id="preview-heading" className="text-base font-semibold text-white">
              Have a preview PIN?
            </h2>
            <p className="mt-1 mb-4 text-sm text-white/65">For our team and invited testers.</p>
            <UnlockForm next={next} />
          </section>
        </Container>
      </main>

      <footer className="border-t border-white/10">
        <Container className="flex flex-col gap-3 pt-6 pb-safe-6 text-xs leading-relaxed text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <EqualHousingLogo className="size-5 shrink-0 text-white/70" />
            <span>
              {site.legalName}
              {site.brokerLicense && <> · GREC firm license {site.brokerLicense}</>}
            </span>
          </p>
          <p>
            © {new Date().getFullYear()} {site.legalName}
          </p>
        </Container>
      </footer>
    </div>
  );
}
