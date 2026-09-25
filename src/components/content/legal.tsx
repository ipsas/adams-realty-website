import { CheckCircle2, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/section";
import { TocNav, type TocItem } from "./toc-nav";

export type { TocItem };

/**
 * Long-form text styles (paragraphs, lists, links, subheads) for policy pages.
 * Tailwind has no typography plugin here, so children are styled from the
 * container. A plain string rather than `cn()` so tailwind-merge can't fold
 * the descendant variants together.
 */
export const proseClasses =
  "space-y-4 text-base leading-relaxed text-ink-soft " +
  "[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:decoration-brand-200 [&_a]:underline-offset-2 [&_a:hover]:decoration-brand-600 " +
  "[&_h3]:pt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink " +
  "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-1 [&_li]:marker:text-brass-500 " +
  "[&_strong]:font-semibold [&_strong]:text-ink";

/**
 * Two-column document layout: a sticky "On this page" rail on desktop, a
 * collapsible contents list on phones, and the article itself.
 */
export function LegalLayout({ toc, children }: { toc: TocItem[]; children: ReactNode }) {
  return (
    <Container className="grid grid-cols-1 gap-10 pt-12 pb-4 sm:pt-16 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 xl:gap-24">
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto pb-4">
          <TocNav items={toc} />
        </div>
      </aside>
      <details className="group rounded-2xl border border-line bg-surface lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          On this page
          <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <ol className="border-t border-line px-2 py-2">
          {toc.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="flex min-h-10 items-center rounded-lg px-3 text-sm text-ink-soft hover:bg-sunken hover:text-ink"
              >
                {item.title}
              </a>
            </li>
          ))}
        </ol>
      </details>
      <article className="max-w-3xl min-w-0 space-y-14">{children}</article>
    </Container>
  );
}

export function LegalSection({
  id,
  title,
  children,
  after,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  /** Rendered below the text, outside the prose styles (e.g. contact cards). */
  after?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <h2
        id={`${id}-heading`}
        className="font-display-tight text-2xl font-medium text-ink sm:text-[1.75rem]"
      >
        {title}
      </h2>
      <div className={`${proseClasses} mt-4`}>{children}</div>
      {after && <div className="mt-6">{after}</div>}
    </section>
  );
}

/** Plain-English summary box that opens a policy. */
export function KeyPoints({
  id,
  title = "The short version",
  points,
  footnote,
}: {
  id: string;
  title?: string;
  points: ReactNode[];
  footnote?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-24 rounded-3xl bg-brand-50 p-6 ring-1 ring-brand-100 sm:p-8"
    >
      <h2
        id={`${id}-heading`}
        className="text-xs font-semibold tracking-[0.18em] text-brand-700 uppercase"
      >
        {title}
      </h2>
      <ul className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {points.map((p, i) => (
          <li key={i} className="flex gap-3 text-[0.9375rem] leading-relaxed text-ink-soft">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-600" strokeWidth={1.75} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-6 text-sm text-muted">{footnote}</p>}
    </section>
  );
}
