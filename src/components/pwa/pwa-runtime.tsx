"use client";

/**
 * Client-side PWA runtime: service worker registration, install prompt capture, the
 * offline banner and the per-user cache purge on a uid mismatch. Mounted once by the
 * root layout with the signed-in user's id (null when signed out).
 *
 * Foundation stub: WP1 fills this in. Keep this signature.
 */
export function PwaRuntime({ userId }: { userId: string | null }): React.ReactElement | null {
  void userId;
  return null;
}
