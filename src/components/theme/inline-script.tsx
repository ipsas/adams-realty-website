"use client";

/**
 * An inline script that runs once, while the server HTML is parsed. On the client it
 * renders as an inert text/plain data block, so React never creates (or warns about)
 * a <script>; suppressHydrationWarning accepts the type difference.
 * See node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
