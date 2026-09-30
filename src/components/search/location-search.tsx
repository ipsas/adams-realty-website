"use client";

import { Building2, Hash, Home, Loader2, MapPin, Search, Waves } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { Suggestion } from "@/lib/listings/queries";

const ICONS = {
  city: Building2,
  neighborhood: MapPin,
  zip: Hash,
  address: Home,
  lake: Waves,
} as const;

/**
 * Location box with typeahead (areas + addresses). Picking an area runs a
 * search; picking an address jumps straight to that home.
 */
export function LocationSearch({
  defaultValue = "",
  onSearch,
  size = "md",
  placeholder = "City, neighborhood, ZIP or address",
  autoFocus = false,
  className,
  buttonLabel,
}: {
  defaultValue?: string;
  /** Called with the chosen location text. */
  onSearch: (q: string) => void;
  size?: "md" | "lg";
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const root = useRef<HTMLFormElement>(null);

  // Follow URL-driven changes to the location (e.g. back button) without an effect.
  const [lastDefault, setLastDefault] = useState(defaultValue);
  if (lastDefault !== defaultValue) {
    setLastDefault(defaultValue);
    setValue(defaultValue);
  }

  const term = value.trim();
  const searchable = term.length >= 2 && term !== defaultValue;

  useEffect(() => {
    if (!searchable) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/locations/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const json = (await res.json()) as { suggestions: Suggestion[] };
        setItems(json.suggestions);
        setActive(-1);
      } catch {
        // Aborted or offline — keep the last suggestions.
      } finally {
        setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term, searchable]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  const choose = (s: Suggestion) => {
    setOpen(false);
    if (s.kind === "address") {
      router.push(`/homes/${s.value}`);
      return;
    }
    // A lake's label says "(lake area)"; the box keeps just its name, like the URL.
    setValue(s.kind === "lake" ? s.value : s.label);
    onSearch(s.value);
  };

  const showList = open && searchable && items.length > 0;
  const lg = size === "lg";

  return (
    <form
      ref={root}
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (active >= 0 && items[active]) return choose(items[active]);
        setOpen(false);
        onSearch(value.trim());
      }}
    >
      <div
        className={cn(
          "flex items-center gap-2 bg-surface transition-shadow",
          lg
            ? "h-16 rounded-2xl pr-2 pl-5 shadow-pop"
            : "h-10 rounded-full border border-line-strong pr-1 pl-3.5 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100",
        )}
      >
        <Search className={cn("shrink-0 text-muted", lg ? "size-5" : "size-4")} />
        <input
          type="search"
          role="combobox"
          aria-label="Search by location"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden",
            lg ? "text-lg" : "text-sm",
          )}
        />
        {loading && <Loader2 className="size-4 shrink-0 animate-spin text-faint" />}
        <button
          type="submit"
          className={cn(
            "flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white transition-colors hover:bg-primary-hover",
            lg ? "h-12 px-6 text-base" : "size-8 rounded-full",
          )}
          aria-label="Search"
        >
          {lg ? (buttonLabel ?? "Search") : <Search className="size-4" />}
        </button>
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-2 animate-rise overflow-hidden rounded-2xl border border-line bg-surface py-2 shadow-pop"
        >
          {items.map((s, i) => {
            const Icon = ICONS[s.kind];
            return (
              <li
                key={`${s.kind}-${s.value}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-left",
                  i === active && "bg-sunken",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{s.label}</span>
                  {s.sublabel && (
                    <span className="block truncate text-xs text-muted">{s.sublabel}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
