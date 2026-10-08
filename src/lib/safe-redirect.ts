/** Any origin works: it only resolves paths, and nothing is ever fetched from it. */
const BASE = "http://next.invalid";

/**
 * Only same-origin paths are allowed as post-login (and post-unlock) destinations, so a
 * crafted `?next=` can't send anyone to another site (open redirect). A destination must
 * start with one "/" and not "//" or "/\" (both mean another host to a browser), and may
 * not contain control characters or backslashes: browsers drop tabs and newlines from
 * URLs, so "/\t/evil.example" would become "//evil.example", and read "\" as "/".
 *
 * The check is made on the path as a browser resolves it, and that resolved form is what
 * comes back: dot segments ("/.//evil.example", "/a/..//evil.example", "/%2e//…") collapse
 * to "//evil.example", which Next's router would follow off the site.
 */
export function safeNext(next: string | string[] | undefined | null, fallback = "/"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname.startsWith("//")) return fallback;
  return url.pathname + url.search + url.hash;
}
