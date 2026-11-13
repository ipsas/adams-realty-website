import { cn } from "@/lib/cn";
import type { PhoneLink } from "@/lib/listings/firm-phones";

/**
 * The firm's office phone on its own listings (firmListingPhones): the primary,
 * tap-to-call number right after the firm's name. Never inside another link.
 */
export function OfficePhoneLink({ phone, className }: { phone: PhoneLink; className?: string }) {
  return (
    <a
      href={phone.href}
      className={cn("font-medium whitespace-nowrap text-brand-700 hover:underline", className)}
    >
      {phone.text}
    </a>
  );
}

/** The smaller line below it: the broker's cell, and any other number the listing shows. */
export function SecondaryPhones({
  phones,
  className,
}: {
  phones: PhoneLink[];
  className?: string;
}) {
  return (
    <p className={cn("text-xs text-muted", className)}>
      {phones.map((p, i) => (
        <span key={p.href}>
          {i > 0 && " · "}
          {/* WCAG 2.2 target size: a 24px-tall hit area, the text stays small. */}
          <a
            href={p.href}
            className="inline-flex min-h-6 items-center whitespace-nowrap hover:underline"
          >
            {p.text}
          </a>
        </span>
      ))}
    </p>
  );
}
