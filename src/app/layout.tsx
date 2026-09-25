import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SavedHomesProvider } from "@/components/listings/saved-homes-provider";
import { SiteHeader, type HeaderUser } from "@/components/layout/site-header";
import { TabBar } from "@/components/layout/tab-bar";
import { InlineScript } from "@/components/theme/inline-script";
import { ThemeSync } from "@/components/theme/theme-sync";
import { PwaRuntime } from "@/components/pwa/pwa-runtime";
import { Toaster } from "@/components/ui/toast";
import { site } from "@/config/site";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getSavedListingIds } from "@/lib/listings/queries";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${site.name} — Homes for sale in ${site.market.name}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  openGraph: { type: "website", siteName: site.name, locale: "en_US" },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  // Next emits only mobile-web-app-capable for appleWebApp.capable; older iOS wants this one.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  // Match my device follows the OS; a forced Light or Dark adds meta#theme-color-override
  // first in <head> (THEME_SCRIPT, then applyTheme). No colorScheme meta: CSS sets it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  // Draw under notches/home indicator (content opts in via the --sai-* safe-area utilities)
  // and let Android shrink the layout viewport for the keyboard.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  const savedIds = session ? await getSavedListingIds(session.user.id) : [];
  const user: HeaderUser = session
    ? {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
        role: (session.user.role ?? "user") as NonNullable<HeaderUser>["role"],
      }
    : null;

  return (
    // The head script sets data-theme before first paint; React must keep it.
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <head>
        <InlineScript html={THEME_SCRIPT} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <ThemeSync />
        <a
          href="#main"
          className="sr-only z-[100] rounded-lg bg-ink px-4 py-2 text-on-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SavedHomesProvider initialIds={savedIds} signedIn={!!session}>
          <SiteHeader user={user} />
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
          {/* Always rendered; visibility is CSS-only (phone:/wide: and chrome markers). */}
          <TabBar user={user} />
          <Toaster />
          <PwaRuntime userId={user?.id ?? null} />
        </SavedHomesProvider>
      </body>
    </html>
  );
}
