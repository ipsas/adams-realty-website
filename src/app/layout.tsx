import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { SavedHomesProvider } from "@/components/listings/saved-homes-provider";
import { SiteHeader, type HeaderUser } from "@/components/layout/site-header";
import { site } from "@/config/site";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getSavedListingIds } from "@/lib/listings/queries";
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
};

export const viewport: Viewport = {
  themeColor: "#fbfaf7",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  const savedIds = session ? await getSavedListingIds(session.user.id) : [];
  const user: HeaderUser = session
    ? {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
        role: (session.user.role ?? "user") as NonNullable<HeaderUser>["role"],
      }
    : null;

  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-[100] rounded-lg bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <SavedHomesProvider initialIds={savedIds} signedIn={!!session}>
          <SiteHeader user={user} />
          <div id="main" className="flex flex-1 flex-col">
            {children}
          </div>
        </SavedHomesProvider>
      </body>
    </html>
  );
}
