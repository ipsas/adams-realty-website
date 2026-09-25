"use client";

import { BellPlus, Check } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { describeCriteria, type SearchCriteria } from "@/lib/search/params";
import { saveSearch } from "@/server/actions/saved";

export function SaveSearchButton({
  criteria,
  signedIn,
}: {
  criteria: SearchCriteria;
  signedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const query = params.toString();

  return (
    <>
      <Button
        variant={saved ? "subtle" : "primary"}
        className="rounded-full"
        onClick={() => {
          if (!signedIn) {
            router.push(
              `/sign-in?next=${encodeURIComponent(`${pathname}?${query}`)}&reason=save-search`,
            );
            return;
          }
          setError(null);
          setOpen(true);
        }}
      >
        {saved ? <Check /> : <BellPlus />}
        {saved ? "Search saved" : "Save search"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Save this search"
        className="w-[min(28rem,calc(100vw-2rem))]"
      >
        <form
          className="space-y-5 px-6 py-6"
          action={(form) => {
            startTransition(async () => {
              const res = await saveSearch({
                query,
                name: String(form.get("name") ?? ""),
                alertFrequency: String(form.get("alertFrequency") ?? "daily"),
              });
              if (res.ok) {
                setSaved(true);
                setOpen(false);
              } else {
                setError("We couldn't save that search. Please try again.");
              }
            });
          }}
        >
          <p className="text-sm text-muted">
            We&apos;ll email you when new homes match — and when prices drop.
          </p>
          <Field label="Name" htmlFor="search-name">
            <Input
              id="search-name"
              name="name"
              defaultValue={describeCriteria(criteria)}
              maxLength={120}
            />
          </Field>
          <Field label="Email me" htmlFor="alert-frequency">
            <Select id="alert-frequency" name="alertFrequency" defaultValue="daily">
              <option value="instant">As soon as homes are listed</option>
              <option value="daily">Once a day</option>
              <option value="weekly">Once a week</option>
              <option value="off">Never — just save it</option>
            </Select>
          </Field>
          <FormMessage>{error}</FormMessage>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save search"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
