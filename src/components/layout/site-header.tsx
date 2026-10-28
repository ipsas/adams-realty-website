"use client";

import { Heart, LayoutDashboard, LogOut, Menu, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { nav } from "@/config/site";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { AppearanceControl } from "../theme/appearance-control";
import { ThemeMenuButton } from "../theme/theme-menu-button";
import { Popover } from "../ui/popover";
import { Logo } from "./logo";

export type HeaderUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "user" | "agent" | "admin";
} | null;

export function SiteHeader({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  const overHero = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

  // Close the mobile menu on navigation (state reset during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  const transparent = overHero && !scrolled && !mobileOpen;
  const isActive = (href: string) => {
    const path = href.split("?")[0];
    return path === "/"
      ? pathname === "/"
      : pathname.startsWith(path) && !href.includes("mode=rent");
  };

  return (
    <>
      <header
        data-site-header
        className={cn(
          "z-50 w-full transition-[top,background-color,border-color,box-shadow] duration-300",
          overHero ? "fixed top-0" : "sticky top-0",
          transparent
            ? "border-b border-transparent bg-transparent"
            : "border-b border-line bg-canvas/85 backdrop-blur-xl backdrop-saturate-150",
        )}
      >
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 pr-safe-4 pl-safe-4 sm:gap-8 sm:pr-safe-6 sm:pl-safe-6 lg:pr-safe-8 lg:pl-safe-8">
          <Logo inverse={transparent} className="min-w-0 shrink overflow-hidden" />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  transparent
                    ? "text-white/85 hover:bg-white/10 hover:text-white"
                    : isActive(item.href)
                      ? "text-ink"
                      : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Wide screens only (the shell's `wide`, not md:): a phone in landscape is
              past md but gets the menu's segmented control instead. */}
            <ThemeMenuButton transparent={transparent} className="hidden wide:block" />
            {pathname !== "/homes" && (
              <Link
                href="/homes"
                aria-label="Search homes"
                className={cn(
                  "hidden size-10 items-center justify-center rounded-full transition-colors sm:flex md:hidden",
                  transparent ? "text-white hover:bg-white/10" : "text-ink-soft hover:bg-sunken",
                )}
              >
                <Search className="size-5" />
              </Link>
            )}
            <Link
              href="/saved"
              aria-label="Saved"
              className={cn(
                "hidden h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors sm:flex",
                transparent
                  ? "text-white hover:bg-white/10"
                  : "text-ink-soft hover:bg-sunken hover:text-ink",
              )}
            >
              <Heart className="size-[18px]" />
              <span className="hidden lg:inline">Saved</span>
            </Link>
            {user ? (
              <UserMenu user={user} transparent={transparent} />
            ) : (
              <Link
                href={`/sign-in?next=${encodeURIComponent(pathname)}`}
                className={cn(
                  "flex h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                  transparent
                    ? "bg-surface text-ink hover:bg-surface/90"
                    : "bg-ink text-on-ink hover:bg-ink-soft",
                )}
              >
                Sign in
              </Link>
            )}
            <button
              type="button"
              className={cn(
                // `phone:flex`: a phone in landscape is past md but still needs the menu.
                "flex size-10 items-center justify-center rounded-full md:hidden phone:flex",
                transparent ? "text-white hover:bg-white/10" : "text-ink hover:bg-sunken",
              )}
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav
            className="max-h-[calc(100dvh-var(--header-h))] animate-rise overflow-y-auto overscroll-contain border-t border-line bg-canvas px-4 pt-2 pb-6 md:hidden phone:block"
            aria-label="Mobile"
          >
            {[...nav, { label: "Saved homes", href: "/saved" }].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-xl px-3 py-3 text-base font-medium text-ink hover:bg-sunken"
              >
                {item.label}
              </Link>
            ))}
            <div className="mx-3 mt-3 mb-4 h-px bg-line" />
            <AppearanceControl variant="segmented" className="px-3" />
          </nav>
        )}
      </header>
    </>
  );
}

function UserMenu({ user, transparent }: { user: NonNullable<HeaderUser>; transparent: boolean }) {
  const router = useRouter();
  const staff = user.role === "agent" || user.role === "admin";
  return (
    <Popover
      align="end"
      showChevron={false}
      fixedOnMobile={false}
      panelClassName="min-w-60 p-2"
      label={
        <span
          className={cn(
            "-mx-2 flex size-8 items-center justify-center rounded-full text-xs font-semibold",
            transparent ? "bg-white/20 text-white" : "bg-primary text-white",
          )}
          aria-label="Account menu"
        >
          {initials(user.name) || <UserRound className="size-4" />}
        </span>
      }
    >
      {
        <div className="flex flex-col text-sm">
          <div className="px-3 pt-2 pb-3">
            <p className="font-semibold text-ink">{user.name}</p>
            <p className="truncate text-muted">{user.email}</p>
          </div>
          <div className="h-px bg-line" />
          {staff && (
            <MenuLink href="/dashboard" icon={<LayoutDashboard className="size-4" />}>
              Dashboard
            </MenuLink>
          )}
          <MenuLink href="/saved" icon={<Heart className="size-4" />}>
            Saved homes & searches
          </MenuLink>
          <MenuLink href="/account" icon={<UserRound className="size-4" />}>
            Account
          </MenuLink>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-ink-soft hover:bg-sunken hover:text-ink"
            onClick={async () => {
              await authClient.signOut();
              router.refresh();
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      }
    </Popover>
  );
}

function MenuLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-ink-soft hover:bg-sunken hover:text-ink"
    >
      {icon}
      {children}
    </Link>
  );
}
