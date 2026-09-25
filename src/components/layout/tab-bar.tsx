"use client";

import type { HeaderUser } from "./site-header";

/**
 * Phone app tab bar (Home, Search, Saved, Account). Always mounted by the root layout;
 * shown only in the phone variant and hidden by `data-own-chrome~="bottom"`.
 *
 * Foundation stub: WP2 replaces the body with `nav[data-tabbar][data-bottom-bar=tab]`.
 * Keep this signature.
 */
export function TabBar({ user }: { user: HeaderUser }): React.ReactElement | null {
  void user;
  return null;
}
