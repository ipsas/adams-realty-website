/** Only same-origin paths are allowed as post-login destinations (prevents open redirects). */
export function safeNext(next: string | string[] | undefined | null, fallback = "/"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return fallback;
  return value;
}
