import { ArrowRight, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { LinkButton, buttonClasses } from "@/components/ui/button";
import { Container } from "@/components/ui/section";
import { site } from "@/config/site";
import { telHref } from "./contact";

/** Closing call to action for company pages: message us, or call the office. */
export function ContactCta({
  eyebrow = "Let's talk",
  title,
  body,
}: {
  eyebrow?: string;
  title: ReactNode;
  body: ReactNode;
}) {
  return (
    <section className="py-8">
      <Container>
        <div className="grid grid-cols-1 items-center gap-10 overflow-hidden rounded-[2rem] bg-brass-100 p-8 sm:p-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:p-16">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-700 uppercase">
              {eyebrow}
            </p>
            <h2 className="font-display-tight text-4xl font-normal text-ink sm:text-5xl">
              {title}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-soft">{body}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <LinkButton href="/contact" size="lg">
              Send us a message <ArrowRight />
            </LinkButton>
            <a href={telHref(site.phone)} className={buttonClasses("secondary", "lg")}>
              <Phone /> Call {site.phone}
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}
