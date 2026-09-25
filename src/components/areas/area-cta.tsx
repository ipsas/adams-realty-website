import { ArrowRight, Phone } from "lucide-react";
import { buttonClasses, LinkButton } from "@/components/ui/button";
import { site } from "@/config/site";

/** Closing band on a guide: a valuation for owners, a question line for shoppers. */
export function AreaCta({ areaName }: { areaName: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="relative isolate overflow-hidden rounded-[2rem] bg-brand-900 p-8 text-white sm:p-10 lg:p-12">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(36rem_18rem_at_100%_0%,rgb(200_155_90/0.2),transparent_60%)]"
        />
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-400 uppercase">
          Own in {areaName}?
        </p>
        <h2 className="font-display-tight text-3xl font-normal sm:text-4xl">
          Find out what your home is worth.
        </h2>
        <p className="mt-4 max-w-md leading-relaxed text-white/75">
          A local agent will price your home against recent {areaName} sales and what&apos;s on the
          market now. Free, with no obligation.
        </p>
        <LinkButton href="/sell#valuation" variant="inverse" size="lg" className="mt-8">
          Get my home value <ArrowRight />
        </LinkButton>
      </div>
      <div className="rounded-[2rem] bg-brass-100 p-8 sm:p-10 lg:p-12">
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-brass-700 uppercase">
          Shopping here?
        </p>
        <h2 className="font-display-tight text-3xl font-normal text-ink sm:text-4xl">
          Ask us anything about {areaName}.
        </h2>
        <p className="mt-4 max-w-md leading-relaxed text-ink-soft">
          A street you&apos;re curious about, a home you saw online, what sold nearby. One local
          agent will get back to you.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/contact" size="lg">
            Send us a message
          </LinkButton>
          <a
            href={`tel:${site.phone.replace(/\D/g, "")}`}
            className={buttonClasses("secondary", "lg")}
          >
            <Phone /> {site.phone}
          </a>
        </div>
      </div>
    </div>
  );
}
