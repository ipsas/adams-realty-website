"use client";

import { LockKeyhole } from "lucide-react";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/form";
import { unlockPreview, type PreviewUnlockState } from "@/server/actions/preview";

/** "Have a preview PIN?": one field and a button. Works without JavaScript too. */
export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<PreviewUnlockState, FormData>(unlockPreview, {});
  // Unlocked on the way to a link from an account email: open it as a full page load.
  useEffect(() => {
    if (state.go) window.location.assign(state.go);
  }, [state.go]);
  const busy = pending || !!state.go;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <Label htmlFor="preview-password" className="text-white/80">
        Preview PIN
      </Label>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Input
          id="preview-password"
          name="password"
          type="password"
          // A short shared PIN: the number keypad on phones, and no password-manager prompt (the
          // site's real sign-in lives on this origin too).
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          required
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "preview-error" : undefined}
          className="min-w-0 sm:flex-1"
        />
        <Button type="submit" variant="inverse" disabled={busy} className="h-11 shrink-0">
          <LockKeyhole />
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </div>
      {state.error && (
        <div id="preview-error">
          <FormMessage>{state.error}</FormMessage>
        </div>
      )}
    </form>
  );
}
