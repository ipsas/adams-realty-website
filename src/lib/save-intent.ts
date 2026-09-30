import {
  browserSessionStorage,
  type KeyValueStorage,
  readJSON,
  remove,
  SESSION_KEYS,
  writeJSON,
} from "@/lib/local-store";

/*
 * A signed-out heart tap sends the buyer to sign in with `save=<id>` on the way back
 * (saveIntentNext in src/components/listings/saved-homes-provider.tsx). The address alone
 * isn't proof the buyer asked: anyone can send a link with `save=`. So the tap also leaves a
 * one-time intent in this tab's sessionStorage, and the home is saved only when both match.
 */

/** How long a heart tap's save intent waits for the sign-in to finish. */
export const SAVE_INTENT_MS = 60 * 60_000;

/**
 * Records that this tab's visitor tapped a heart while signed out (SESSION_KEYS.saveIntent),
 * so the `save=` on the way back from sign-in is theirs and not someone else's link.
 */
export function rememberSaveIntent(
  id: string,
  storage: KeyValueStorage | null = browserSessionStorage(),
  now = Date.now(),
): void {
  writeJSON(SESSION_KEYS.saveIntent, { id, at: now }, storage);
}

/**
 * Whether `save=<id>` comes from this tab's own heart tap, within SAVE_INTENT_MS. The
 * intent is used up either way: a later visit to the same address saves nothing.
 */
export function takeSaveIntent(
  id: string,
  storage: KeyValueStorage | null = browserSessionStorage(),
  now = Date.now(),
): boolean {
  const intent = readJSON<{ id?: unknown; at?: unknown } | null>(
    SESSION_KEYS.saveIntent,
    null,
    storage,
  );
  remove(SESSION_KEYS.saveIntent, storage);
  return (
    !!intent &&
    intent.id === id &&
    typeof intent.at === "number" &&
    now - intent.at >= 0 &&
    now - intent.at <= SAVE_INTENT_MS
  );
}
