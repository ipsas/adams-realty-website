import type { ReactNode } from "react";
import { Photo } from "@/components/ui/photo";

const IMAGE =
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-[calc(100dvh-4rem-var(--demo-bar-h,0px))] grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h1 className="font-display-tight text-4xl font-normal text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-900 lg:block">
        <Photo
          src={IMAGE}
          alt=""
          sizes="50vw"
          className="absolute inset-0 size-full"
          fallbackClassName="from-brand-700 via-brand-800 to-brand-900 [&>svg]:hidden"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-shade/70 via-transparent to-transparent" />
        <blockquote className="absolute inset-x-10 bottom-10 text-white">
          <p className="font-display-tight text-3xl leading-snug font-light">
            “Save homes, get an email when something new fits, and keep every favorite in one
            place.”
          </p>
          <footer className="mt-4 text-sm text-white/70">Your free Adams Realty account</footer>
        </blockquote>
      </div>
    </div>
  );
}
