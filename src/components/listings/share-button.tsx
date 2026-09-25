"use client";

import { Check, Share } from "lucide-react";
import { useState } from "react";

export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const url = window.location.href;
        if (navigator.share) {
          try {
            await navigator.share({ title, url });
            return;
          } catch {
            // Cancelled — fall back to copying.
          }
        }
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-sunken"
    >
      {copied ? (
        <Check className="size-[18px] text-brand-600" />
      ) : (
        <Share className="size-[18px]" />
      )}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
