/**
 * Agent bios as stored: plain text, paragraphs separated by a blank line (the
 * dashboard's textarea, or the seed). Many agents have no bio yet, so every
 * helper takes null. Pure, so the profile page and its metadata read a bio the
 * same way.
 */

/**
 * The bio's paragraphs, trimmed, with no empty ones; [] for no bio. A single
 * line break stays inside its paragraph (the page keeps it with
 * `whitespace-pre-line`). Windows line endings, which a form submission sends,
 * count the same.
 */
export function bioParagraphs(bio: string | null | undefined): string[] {
  if (!bio) return [];
  return bio
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * The bio as one line for a meta description: whitespace collapsed, and cut
 * at a word boundary with "…" when it runs past `max` characters. Null when
 * there's no bio.
 */
export function bioExcerpt(bio: string | null | undefined, max = 160): string | null {
  const text = bioParagraphs(bio).join(" ").replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // Ends on a whole word already, or back up to the last one (unless that loses half the text).
  const words = text[max - 1] === " " || space <= max / 2 ? cut : cut.slice(0, space);
  return `${words.replace(/[\s,;:–—-]+$/, "")}…`;
}
