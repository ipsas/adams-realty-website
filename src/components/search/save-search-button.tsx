"use client";

import { BellPlus, Check } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { Honeypot, useFormTimer } from "@/components/ui/spam-guard";
import { describeCriteria, type SearchCriteria } from "@/lib/search/params";
import { FORM_TOKEN_FIELD, HONEYPOT_FIELD } from "@/lib/spam";
import { saveSearch } from "@/server/actions/saved";

/**
 * Opens the save-search dialog, or sends a signed-out buyer to sign in first. Shared by
 * the Save search button and the no-results page's "Email me when homes list here", so
 * the page keeps one dialog and one Save search button.
 */
export function useSaveSearch(signedIn: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const query = params.toString();
  const launch = () => {
    if (!signedIn) {
      router.push(`/sign-in?next=${encodeURIComponent(`${pathname}?${query}`)}&reason=save-search`);
      return;
    }
    setOpen(true);
  };
  return { open, setOpen, saved, setSaved, launch, query };
}

export type SaveSearchState = ReturnType<typeof useSaveSearch>;

export function SaveSearchButton({
  criteria,
  save,
}: {
  criteria: SearchCriteria;
  save: SaveSearchState;
}) {
  const { open, setOpen, saved, setSaved, query } = save;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Timed from when the search page opened: the dialog itself comes pre-filled.
  const stamp = useFormTimer();

  return (
    <>
      <Button
        variant={saved ? "subtle" : "primary"}
        className="shrink-0 rounded-full"
        onClick={() => {
          setError(null);
          save.launch();
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
              await stamp(form);
              const res = await saveSearch({
                query,
                name: String(form.get("name") ?? ""),
                alertFrequency: String(form.get("alertFrequency") ?? "daily"),
                website: String(form.get(HONEYPOT_FIELD) ?? ""),
                formToken: String(form.get(FORM_TOKEN_FIELD) ?? ""),
              });
              if (res.ok) {
                setSaved(true);
                setOpen(false);
              } else {
                setError(
                  res.error === "unauthenticated"
                    ? "Please sign in again to save this search."
                    : res.error,
                );
              }
            });
          }}
        >
          <p className="text-sm text-muted">
            We&apos;ll email you when new homes match — and when prices drop.
          </p>
          <Honeypot />
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
