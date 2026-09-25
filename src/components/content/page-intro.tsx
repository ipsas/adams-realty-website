import type { ReactNode } from "react";
import { Container } from "@/components/ui/section";
import { cn } from "@/lib/cn";

/**
 * Opening band for company and legal pages: eyebrow, display headline, lead
 * paragraph, plus optional actions (`children`) and a right-hand `aside` on
 * desktop. `dark` matches the evergreen heroes on the home and sell pages;
 * `light` suits long reading pages like the privacy policy.
 */
export function PageIntro({
  eyebrow,
  title,
  lead,
  meta,
  aside,
  children,
  tone = "light",
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  /** Small print under the lead, e.g. "Last updated …". */
  meta?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <header
      className={cn(
        "relative isolate overflow-hidden",
        dark ? "bg-brand-900 text-white" : "border-b border-line bg-sunken/60",
      )}
    >
      {dark && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_85%_-10%,rgb(200_155_90/0.16),transparent_60%),radial-gradient(40rem_24rem_at_0%_110%,rgb(47_117_88/0.35),transparent_65%)]"
        />
      )}
      <Container
        className={cn(
          "grid grid-cols-1 items-end gap-12",
          dark ? "py-20 sm:py-24 lg:py-28" : "py-14 sm:py-20",
          aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-20",
        )}
      >
        <div className="min-w-0">
          <p
            className={cn(
              "mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase",
              dark ? "text-brass-400" : "text-brass-500",
            )}
          >
            <span className={cn("h-px w-8", dark ? "bg-brass-400" : "bg-brass-500")} />
            {eyebrow}
          </p>
          <h1
            className={cn(
              "max-w-3xl font-display-tight text-4xl leading-[1.05] font-normal sm:text-5xl lg:text-6xl",
              dark ? "text-white" : "text-ink",
            )}
          >
            {title}
          </h1>
          {lead && (
            <p
              className={cn(
                "mt-6 max-w-2xl text-lg leading-relaxed",
                dark ? "text-white/75" : "text-muted",
              )}
            >
              {lead}
            </p>
          )}
          {meta && (
            <p className={cn("mt-5 text-sm", dark ? "text-white/60" : "text-faint")}>{meta}</p>
          )}
          {children && <div className="mt-9 flex flex-wrap gap-3">{children}</div>}
        </div>
        {aside}
      </Container>
    </header>
  );
}
