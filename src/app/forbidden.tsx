import { LinkButton } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-sm font-semibold tracking-widest text-brass-500 uppercase">403</p>
      <h1 className="mt-3 font-display-tight text-4xl text-ink">
        This area is for Adams Realty staff
      </h1>
      <p className="mt-3 max-w-md text-muted">
        Your account doesn&apos;t have access to this page. If you&apos;re an agent, ask your broker
        to update your role.
      </p>
      <LinkButton href="/" className="mt-8">
        Back to home
      </LinkButton>
    </main>
  );
}
