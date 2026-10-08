import Link from "next/link";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" className="fill-brand-700" />
      {/* Roofline that doubles as an "A" */}
      <path
        d="M8 23.5 16 8.5l8 15"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11.4 18h9.2" stroke="#c89b5a" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Wordmark({ inverse }: { inverse: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "font-display-tight text-[1.35rem] leading-none font-semibold",
          inverse ? "text-white" : "text-ink",
        )}
      >
        Adams
      </span>
      <span
        className={cn(
          "text-[0.65rem] font-semibold tracking-[0.22em] uppercase",
          inverse ? "text-white/70" : "text-muted",
        )}
      >
        Realty
      </span>
    </span>
  );
}

export function Logo({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  return (
    <Link
      href="/"
      className={cn("group flex items-center gap-2.5", className)}
      aria-label={`${site.name} home`}
    >
      <LogoMark className="shrink-0 transition-transform duration-300 group-hover:-rotate-3" />
      <Wordmark inverse={inverse} />
    </Link>
  );
}

/** The logo without the link home, for pages that stand alone (the coming-soon page). */
export function LogoLockup({
  className,
  inverse = false,
}: {
  className?: string;
  inverse?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="shrink-0" />
      <Wordmark inverse={inverse} />
    </span>
  );
}
