import { Clock, Mail, MapPin, Phone, type LucideIcon } from "lucide-react";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { addressLines, directionsHref, hasStreetAddress, mailtoHref, telHref } from "./contact";

type MethodKey = "phone" | "email" | "hours" | "office";

type Method = {
  key: MethodKey;
  icon: LucideIcon;
  label: string;
  lines: string[];
  href?: string;
  external?: boolean;
  hint?: string;
};

/** The firm's phone, email, hours and location from site config, in display order. */
function methods(subject?: string): Method[] {
  const street = hasStreetAddress(site.address);
  const directions = directionsHref(site.address);
  const all: (Method | null)[] = [
    {
      key: "phone",
      icon: Phone,
      label: "Call",
      lines: [site.phone],
      href: telHref(site.phone),
    },
    {
      key: "email",
      icon: Mail,
      label: "Email",
      lines: [site.email],
      href: mailtoHref(site.email, subject),
    },
    // Hidden until the firm publishes its hours.
    site.hours ? { key: "hours", icon: Clock, label: "Office hours", lines: [site.hours] } : null,
    {
      key: "office",
      icon: MapPin,
      // Until the firm publishes a street address, show where it's based instead.
      label: street ? "Office" : "Based in",
      lines: addressLines(site.address),
      href: directions ?? undefined,
      external: !!directions,
      hint: street ? "Get directions" : `Serving ${site.market.region}`,
    },
  ];
  return all.filter((m): m is Method => m !== null);
}

/**
 * Contact cards for the firm. Phone and email are whole-card tap targets
 * (tel:/mailto:). `subject` pre-fills the email subject, e.g. "Privacy request".
 */
export function ContactMethods({
  subject,
  tone = "light",
  only,
  className,
}: {
  subject?: string;
  tone?: "light" | "dark";
  /** Limit to some methods, e.g. `["phone", "email"]`. */
  only?: MethodKey[];
  className?: string;
}) {
  const dark = tone === "dark";
  const items = methods(subject).filter((m) => !only || only.includes(m.key));
  return (
    <ul className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {items.map((m) => {
        const body = (
          <>
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                dark ? "bg-brass-400/15 text-brass-400" : "bg-brand-50 text-brand-700",
              )}
            >
              <m.icon className="size-[1.125rem]" strokeWidth={1.75} />
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-xs font-semibold tracking-widest uppercase",
                  dark ? "text-white/55" : "text-muted",
                )}
              >
                {m.label}
              </span>
              {m.key === "office" ? (
                <address
                  className={cn(
                    "mt-0.5 block text-base font-semibold not-italic",
                    dark ? "text-white" : "text-ink",
                  )}
                >
                  {m.lines.map((l) => (
                    <span key={l} className="block">
                      {l}
                    </span>
                  ))}
                </address>
              ) : (
                <span
                  className={cn(
                    "mt-0.5 block text-base font-semibold [overflow-wrap:anywhere]",
                    dark ? "text-white" : "text-ink",
                  )}
                >
                  {m.lines.join(" ")}
                </span>
              )}
              {m.hint && (
                <span className={cn("mt-0.5 block text-sm", dark ? "text-white/60" : "text-muted")}>
                  {m.hint}
                </span>
              )}
            </span>
          </>
        );
        const card = cn(
          "flex h-full items-start gap-4 rounded-2xl p-4 ring-1 ring-inset",
          dark ? "bg-white/[0.04] ring-white/10" : "bg-surface ring-line",
        );
        return (
          <li key={m.key}>
            {m.href ? (
              <a
                href={m.href}
                {...(m.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className={cn(
                  card,
                  "transition-colors",
                  dark ? "hover:bg-white/[0.08] hover:ring-white/20" : "hover:ring-line-strong",
                )}
              >
                {body}
              </a>
            ) : (
              <div className={card}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
