"use client";

import { useCallback, useEffect, useRef } from "react";
import { ELAPSED_FIELD, HONEYPOT_FIELD } from "@/lib/spam";

/*
 * The client half of the form spam checks (src/lib/spam.ts): a honeypot field
 * and a timer. Every public form renders <Honeypot /> and passes its FormData
 * through `stamp` before sending, which adds how long the form has been open.
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

/**
 * Returns `stamp(formData)`, which records the milliseconds since the form
 * mounted (the visitor's own clock, so a wrong device clock doesn't matter).
 * A form sent before hydration has no stamp, which the server treats as
 * suspect.
 */
export function useFormTimer() {
  const started = useRef<number | null>(null);
  useEffect(() => {
    started.current = performance.now();
  }, []);
  return useCallback((form: FormData) => {
    if (started.current !== null) {
      form.set(ELAPSED_FIELD, String(Math.round(performance.now() - started.current)));
    }
    return form;
  }, []);
}
