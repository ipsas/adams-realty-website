"use client";

import { useCallback, useEffect, useRef } from "react";
import { FORM_TOKEN_FIELD, FORM_TOKEN_REFRESH_MS, HONEYPOT_FIELD } from "@/lib/spam";

/*
 * The client half of the form spam checks (src/lib/spam.ts): a honeypot field
 * and a timer. Every public form renders <Honeypot /> and passes its FormData
 * through `stamp` before sending, which adds the timer token the page fetched
 * when the form opened (src/lib/form-token.ts); the server measures the time.
 */

/** A field people never see or reach; robots that fill every field fill it. */
export function Honeypot() {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        Website
        <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/form-token", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown };
    return typeof body.token === "string" ? body.token : null;
  } catch {
    return null;
  }
}

/**
 * Returns `stamp(formData)`, which adds the timer token fetched when the form
 * mounted, waiting for it if it's still on its way. A form sent before
 * hydration, or whose token couldn't be fetched, has none, which the server
 * treats as suspect (the lead is still kept for the office to review).
 *
 * A token lives a day (FORM_TOKEN_MAX_AGE_MS), and a phone keeps a tab open for
 * days, so when the page comes back into view with a token older than
 * FORM_TOKEN_REFRESH_MS, it fetches a fresh one: the person has been away for
 * hours, and will take more than the few seconds a form needs once back.
 */
export function useFormTimer() {
  const token = useRef<{ at: number; value: Promise<string | null> } | null>(null);
  useEffect(() => {
    const load = () => {
      token.current = { at: Date.now(), value: fetchToken() };
    };
    const renew = () => {
      const stale = !token.current || Date.now() - token.current.at > FORM_TOKEN_REFRESH_MS;
      if (document.visibilityState === "visible" && stale) load();
    };
    load();
    document.addEventListener("visibilitychange", renew);
    window.addEventListener("pageshow", renew);
    return () => {
      document.removeEventListener("visibilitychange", renew);
      window.removeEventListener("pageshow", renew);
    };
  }, []);
  return useCallback(async (form: FormData) => {
    const t = await token.current?.value;
    if (t) form.set(FORM_TOKEN_FIELD, t);
    return form;
  }, []);
}
