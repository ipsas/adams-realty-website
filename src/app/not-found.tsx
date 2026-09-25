import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-semibold tracking-widest text-brass-500 uppercase">404</p>
      <h1 className="mt-3 font-display-tight text-4xl text-ink">We couldn&apos;t find that page</h1>
      <p className="mt-3 max-w-md text-muted">
        The home may have sold or the link may be out of date. Plenty more where it came from,
        though.
      </p>
      <div className="mt-8 flex gap-3">
        <LinkButton href="/homes">Search homes</LinkButton>
        <LinkButton href="/" variant="secondary">
          Home
        </LinkButton>
      </div>
    </main>
  );
}
