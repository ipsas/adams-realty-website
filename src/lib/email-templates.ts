import { site } from "@/config/site";
import { env } from "@/lib/env";
import { formatBaths, formatNumber, formatPrice } from "@/lib/format";
import { mlsCopyright } from "@/lib/mls-copyright";
import { photoRoute, photoUrl } from "@/lib/photos";

/**
 * Branded transactional and alert emails. Email clients ignore most CSS, so
 * the layout is table-based with inline styles; a single media query stacks
 * listing rows on phones, and clients that drop it still get a fluid,
 * readable layout. Every email has a plain-text version too.
 *
 * Georgia Real Estate Commission rules treat marketing email as advertising,
 * so every footer shows the firm's legal name and phone number from
 * `src/config/site.ts`. Alert emails also carry an unsubscribe link.
 */

// Mirrors the design tokens in src/app/globals.css (emails can't read CSS variables).
const C = {
  brand: "#1a4c39",
  brandTint: "#eef5f1",
  brandSoft: "#d6e8de",
  canvas: "#f4f2ec",
  surface: "#ffffff",
  ink: "#15201c",
  inkSoft: "#3b4843",
  muted: "#66716c",
  faint: "#98a19c",
  line: "#e8e4db",
  brass: "#b3843f",
  brassTint: "#f5ecdc",
  brassText: "#7d5a26",
  clay: "#a8461f",
  clayTint: "#fbefe8",
};
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";

export type RenderedEmail = { subject: string; html: string; text: string };

/** One piece of email content, in both formats. */
export type EmailBlock = { html: string; text: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const esc = escapeHtml;

export function absoluteUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${env.NEXT_PUBLIC_SITE_URL}${path}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** A padded row inside the white card. */
function row(inner: string, padding = "8px 40px"): string {
  return `<tr><td class="px" style="padding:${padding};font-family:${SANS};">${inner}</td></tr>`;
}

export function paragraph(text: string, tone: "body" | "muted" = "body"): EmailBlock {
  const color = tone === "muted" ? C.muted : C.inkSoft;
  const size = tone === "muted" ? 14 : 16;
  return {
    html: row(
      `<p style="margin:0;font-size:${size}px;line-height:1.6;color:${color};">${esc(text)}</p>`,
    ),
    text,
  };
}

export function sectionTitle(title: string, count?: number): EmailBlock {
  const n = count ? ` <span style="color:${C.faint};font-weight:600;">${count}</span>` : "";
  return {
    html: row(
      `<h2 style="margin:0;font-family:${SANS};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.brass};">${esc(title)}${n}</h2>`,
      "24px 40px 4px",
    ),
    text: `${title.toUpperCase()}${count ? ` (${count})` : ""}\n${"-".repeat(title.length + (count ? String(count).length + 3 : 0))}`,
  };
}

/** A right-arrow text link, e.g. "See all 23 new homes". */
export function textLink(label: string, href: string): EmailBlock {
  return {
    html: row(
      `<a href="${esc(href)}" style="font-size:14px;font-weight:600;color:${C.brand};text-decoration:none;">${esc(label)} &rarr;</a>`,
      "8px 40px 4px",
    ),
    text: `${label}: ${href}`,
  };
}

/** Label/value pairs, e.g. a lead's contact details. Empty values are skipped. */
export function detailsTable(
  rows: { label: string; value: string | null | undefined; href?: string }[],
): EmailBlock {
  const present = rows.filter((r): r is { label: string; value: string; href?: string } =>
    Boolean(r.value),
  );
  const cells = present
    .map(
      (r, i) => `<tr>
<td valign="top" style="padding:12px 16px 10px 0;width:132px;font-size:13px;line-height:1.5;color:${C.muted};${i ? `border-top:1px solid ${C.line};` : ""}">${esc(r.label)}</td>
<td valign="top" style="padding:10px 0;font-size:15px;line-height:1.5;color:${C.ink};word-break:break-word;${i ? `border-top:1px solid ${C.line};` : ""}">${
        r.href
          ? `<a href="${esc(r.href)}" style="color:${C.brand};text-decoration:none;font-weight:600;">${esc(r.value)}</a>`
          : esc(r.value)
      }</td></tr>`,
    )
    .join("");
  return {
    html: row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cells}</table>`,
      "12px 40px",
    ),
    text: present.map((r) => `${r.label}: ${r.value}`).join("\n"),
  };
}

/** A quoted message, line breaks preserved (e.g. what a lead wrote). */
export function quote(text: string): EmailBlock {
  const body = esc(text).replace(/\r?\n/g, "<br>");
  return {
    html: row(
      `<div style="padding:16px 18px;border-radius:12px;background:${C.canvas};border-left:3px solid ${C.brass};font-size:15px;line-height:1.6;color:${C.ink};word-break:break-word;">${body}</div>`,
      "12px 40px",
    ),
    text: text
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join("\n"),
  };
}

export type BadgeTone = "brand" | "clay" | "brass" | "ink";

const BADGE_COLORS: Record<BadgeTone, { bg: string; fg: string }> = {
  brand: { bg: C.brandTint, fg: C.brand },
  clay: { bg: C.clayTint, fg: C.clay },
  brass: { bg: C.brassTint, fg: C.brassText },
  ink: { bg: C.canvas, fg: C.ink },
};

/** Everything a listing row shows. URLs must be absolute. */
export type EmailListing = {
  href: string;
  photoUrl: string | null;
  price: number;
  /** e.g. "/mo" for rentals. */
  priceSuffix?: string;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSqft: number | null;
  /** Bare land's facts ("Land · 12.5 acres"), shown instead of beds, baths and sqft. */
  landFacts?: string | null;
  street: string;
  cityLine: string;
  badge?: { label: string; tone: BadgeTone };
  /** Short lines under the address, e.g. "Was $665,000". */
  notes?: string[];
  /**
   * IDX rules: show the listing brokerage wherever MLS listings are displayed, in type
   * not smaller than the median listing text (14px in this row).
   */
  attribution?: string | null;
};

export function listingFacts(
  l: Pick<EmailListing, "bedrooms" | "bathrooms" | "livingAreaSqft" | "landFacts">,
) {
  if (l.landFacts) return l.landFacts;
  return [
    l.bedrooms !== null ? `${l.bedrooms} bd` : null,
    l.bathrooms !== null ? `${formatBaths(l.bathrooms)} ba` : null,
    l.livingAreaSqft ? `${formatNumber(l.livingAreaSqft)} sqft` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Smaller photos for email (3× the 168×112 slot): the sample CDN crops to size; MLS photos
 * come from the site's image optimizer (src/lib/photos.ts), never full size.
 */
function emailPhotoUrl(src: string): string {
  const route = photoRoute(src);
  if (route === "self") {
    const url = new URL(src);
    url.searchParams.set("w", "504");
    url.searchParams.set("h", "336");
    url.searchParams.set("fit", "crop");
    return url.toString();
  }
  if (route === "optimize") return absoluteUrl(photoUrl(src, 504));
  return src;
}

export function listingRow(l: EmailListing): EmailBlock {
  const href = esc(l.href);
  const photo = l.photoUrl
    ? `<img src="${esc(emailPhotoUrl(l.photoUrl))}" width="168" height="112" alt="${esc(`Photo of ${l.street}`)}" class="stack-img" style="display:block;width:168px;height:112px;border:0;border-radius:10px;object-fit:cover;background:${C.brandSoft};color:${C.muted};font-family:${SANS};font-size:12px;line-height:1.4;">`
    : `<div class="stack-ph" style="width:168px;height:112px;border-radius:10px;background:${C.brandTint};color:${C.faint};font-size:12px;line-height:112px;text-align:center;">Photo coming soon</div>`;
  const badge = l.badge
    ? `<div style="margin:0 0 6px;"><span style="display:inline-block;padding:3px 9px;border-radius:999px;background:${BADGE_COLORS[l.badge.tone].bg};color:${BADGE_COLORS[l.badge.tone].fg};font-size:12px;line-height:1.4;font-weight:700;">${esc(l.badge.label)}</span></div>`
    : "";
  const facts = listingFacts(l);
  const notes = (l.notes ?? [])
    .map(
      (n) =>
        `<div style="margin-top:4px;font-size:13px;line-height:1.5;color:${C.inkSoft};">${esc(n)}</div>`,
    )
    .join("");
  const attribution = l.attribution
    ? `<div style="margin-top:8px;font-size:14px;line-height:1.5;color:${C.inkSoft};">${esc(l.attribution)}</div>`
    : "";

  const html = row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${C.line};border-radius:14px;">
<tr>
<td class="stack" width="192" valign="top" style="width:192px;padding:12px;"><a href="${href}" style="text-decoration:none;">${photo}</a></td>
<td class="stack stack-body" valign="top" style="padding:14px 16px 14px 4px;font-family:${SANS};">
${badge}<a href="${href}" style="text-decoration:none;color:${C.ink};"><span style="font-size:20px;line-height:1.3;font-weight:700;color:${C.ink};">${esc(formatPrice(l.price))}</span>${l.priceSuffix ? `<span style="font-size:14px;color:${C.muted};">${esc(l.priceSuffix)}</span>` : ""}</a>
${facts ? `<div style="margin-top:2px;font-size:14px;line-height:1.5;color:${C.inkSoft};">${esc(facts)}</div>` : ""}
<div style="margin-top:6px;font-size:14px;line-height:1.45;"><a href="${href}" style="color:${C.ink};text-decoration:none;font-weight:600;">${esc(l.street)}</a><br><span style="font-size:13px;color:${C.muted};">${esc(l.cityLine)}</span></div>
${notes}${attribution}
</td>
</tr>
</table>`,
    "6px 40px",
  );

  const text = [
    `${formatPrice(l.price)}${l.priceSuffix ?? ""}${l.badge ? ` — ${l.badge.label}` : ""}`,
    facts || null,
    `${l.street}, ${l.cityLine}`,
    ...(l.notes ?? []),
    l.attribution ?? null,
    l.href,
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type EmailLayout = {
  subject: string;
  /** Inbox preview text. */
  preheader: string;
  eyebrow?: string;
  heading: string;
  intro?: string;
  blocks?: EmailBlock[];
  cta?: { label: string; href: string };
  /** Content under the button (fine print, a copy-paste link). */
  afterCta?: EmailBlock[];
  /** Why this person is getting the email. */
  reason?: string;
  /** Alert emails: the signed unsubscribe page for this alert. */
  unsubscribe?: { label: string; href: string };
  manage?: { label: string; href: string };
  /** MLS disclaimers for any listings shown. */
  disclaimers?: string[];
  /**
   * The email shows Georgia MLS listings: credit the MLS by name and logo, its copyright
   * notice and its IDX disclaimer.
   */
  mlsCredit?: boolean;
};

function button(label: string, href: string): EmailBlock {
  return {
    html: row(
      `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${C.brand}" style="border-radius:12px;background:${C.brand};"><a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:15px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(label)}</a></td></tr></table>`,
      "24px 40px 8px",
    ),
    text: `${label}: ${href}`,
  };
}

/** Firm name, phone and postal address (CAN-SPAM wants the address on every marketing email). */
function firmLine(): string {
  const { line1, city, state, postalCode } = site.address;
  const place = [line1, city, `${state} ${postalCode}`.trim()].filter(Boolean).join(", ");
  return [site.legalName, site.phone, place].filter(Boolean).join(" · ");
}

export function renderEmail(o: EmailLayout): RenderedEmail {
  const [brandFirst, ...brandRest] = site.name.split(" ");
  const blocks = [
    ...(o.blocks ?? []),
    ...(o.cta ? [button(o.cta.label, o.cta.href)] : []),
    ...(o.afterCta ?? []),
  ];
  const links = [o.unsubscribe, o.manage].filter((l): l is { label: string; href: string } =>
    Boolean(l),
  );
  const license = site.brokerLicense
    ? `Georgia real estate firm license ${site.brokerLicense}`
    : null;
  const credit = o.mlsCredit ? `Listings courtesy of ${site.mls.name}. ${mlsCopyright()}` : null;
  const disclaimers = [
    ...new Set([...(o.mlsCredit ? [site.mls.disclaimer] : []), ...(o.disclaimers ?? [])]),
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(o.subject)}</title>
<style>
  @media (max-width: 540px) {
    .container { width: 100% !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .h1 { font-size: 26px !important; }
    .stack { display: block !important; width: 100% !important; box-sizing: border-box; }
    .stack-body { padding: 2px 16px 16px !important; }
    .stack-img { width: 100% !important; height: auto !important; }
    .stack-ph { width: 100% !important; height: 140px !important; line-height: 140px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(o.preheader)}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:28px 12px 36px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0 8px 18px;">
  <a href="${esc(absoluteUrl("/"))}" style="text-decoration:none;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td width="32" height="32" align="center" valign="middle" bgcolor="${C.brand}" style="width:32px;height:32px;border-radius:9px;background:${C.brand};color:#ffffff;font-family:${SERIF};font-size:18px;font-weight:600;line-height:32px;">${esc(brandFirst.charAt(0))}</td>
    <td style="padding-left:10px;font-family:${SERIF};font-size:22px;font-weight:600;letter-spacing:-0.02em;color:${C.ink};line-height:32px;">${esc(brandFirst)}</td>
    ${brandRest.length ? `<td style="padding-left:6px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${C.muted};line-height:32px;">${esc(brandRest.join(" "))}</td>` : ""}
  </tr></table>
  </a>
</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td class="px" style="padding:36px 40px 8px;font-family:${SANS};">
  ${o.eyebrow ? `<p style="margin:0 0 10px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${C.brass};">${esc(o.eyebrow)}</p>` : ""}
  <h1 class="h1" style="margin:0;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:500;letter-spacing:-0.02em;color:${C.ink};">${esc(o.heading)}</h1>
  ${o.intro ? `<p style="margin:12px 0 0;font-size:16px;line-height:1.6;color:${C.muted};">${esc(o.intro)}</p>` : ""}
</td></tr>
${blocks.map((b) => b.html).join("\n")}
<tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
</table>
</td></tr>
<tr><td class="px" align="center" style="padding:24px 24px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">
  ${o.reason ? `<p style="margin:0 0 10px;">${esc(o.reason)}</p>` : ""}
  ${links.length ? `<p style="margin:0 0 14px;">${links.map((l) => `<a href="${esc(l.href)}" style="color:${C.brand};font-weight:600;text-decoration:underline;">${esc(l.label)}</a>`).join(`<span style="color:${C.faint};"> &nbsp;·&nbsp; </span>`)}</p>` : ""}
  <p style="margin:0;color:${C.inkSoft};">${esc(firmLine())}</p>
  ${license ? `<p style="margin:2px 0 0;">${esc(license)}</p>` : ""}
  ${credit ? `<p style="margin:12px 0 0;">${site.mls.logo ? `<img src="${esc(absoluteUrl(site.mls.logo.src))}" width="81" height="32" alt="${esc(site.mls.name)}" style="display:block;margin:0 auto 6px;height:32px;width:auto;border:0;">` : ""}<span style="font-size:12px;line-height:1.5;color:${C.inkSoft};">${esc(credit)}</span></p>` : ""}
  ${disclaimers.map((d) => `<p style="margin:12px 0 0;font-size:11px;line-height:1.5;color:${C.faint};">${esc(d)}</p>`).join("")}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    site.name.toUpperCase(),
    "",
    o.heading,
    o.intro ?? null,
    ...blocks.map((b) => `\n${b.text}`),
    "",
    "—",
    o.reason ?? null,
    ...links.map((l) => `${l.label}: ${l.href}`),
    firmLine(),
    license,
    credit,
    ...disclaimers,
  ]
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return { subject: o.subject, html, text };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export type AlertFrequencyLabel = "instant" | "daily" | "weekly";

const INTRO: Record<AlertFrequencyLabel, string> = {
  instant: "Fresh matches for your saved search",
  daily: "Your daily update for",
  weekly: "Your weekly roundup for",
};

/** New listings (or new sales) and price cuts for one saved search. */
export function savedSearchAlertEmail(input: {
  searchName: string;
  frequency: AlertFrequencyLabel;
  /** "sold" searches report newly sold homes instead of new listings. */
  mode: "buy" | "rent" | "sold";
  newListings: EmailListing[];
  newTotal: number;
  priceCuts: EmailListing[];
  priceCutTotal: number;
  /** The saved search on the site, sorted newest first. */
  searchUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
  disclaimers?: string[];
}): RenderedEmail {
  const { newTotal, priceCutTotal, mode } = input;
  const noun = mode === "rent" ? "rental" : "home";
  const newLabel =
    mode === "sold" ? `${plural(newTotal, "home")} just sold` : plural(newTotal, `new ${noun}`);
  const cutLabel = plural(priceCutTotal, mode === "rent" ? "rent drop" : "price cut");
  const parts = [newTotal ? newLabel : null, priceCutTotal ? cutLabel : null].filter(
    (p): p is string => p !== null,
  );

  const heading =
    newTotal && priceCutTotal
      ? `${newLabel} and ${cutLabel}`
      : newTotal
        ? mode === "sold"
          ? newLabel
          : `${newTotal === 1 ? `A new ${noun} matches` : `${newLabel} match`} your search`
        : priceCutTotal === 1
          ? `Price cut on a ${noun} in your search`
          : `${cutLabel} in your search`;
  const top = input.newListings[0] ?? input.priceCuts[0];

  const blocks: EmailBlock[] = [];
  if (input.newListings.length) {
    blocks.push(sectionTitle(mode === "sold" ? "Just sold" : "New listings", newTotal));
    blocks.push(...input.newListings.map(listingRow));
    if (newTotal > input.newListings.length) {
      blocks.push(
        textLink(
          mode === "sold" ? `See all ${newTotal} sales` : `See all ${newLabel}`,
          input.searchUrl,
        ),
      );
    }
  }
  if (input.priceCuts.length) {
    blocks.push(sectionTitle(mode === "rent" ? "Rent drops" : "Price cuts", priceCutTotal));
    blocks.push(...input.priceCuts.map(listingRow));
    if (priceCutTotal > input.priceCuts.length) {
      blocks.push(
        textLink(`${priceCutTotal - input.priceCuts.length} more in your search`, input.searchUrl),
      );
    }
  }

  return renderEmail({
    subject: `${parts.join(", ")}: ${input.searchName}`,
    preheader: top
      ? `${formatPrice(top.price)}${top.priceSuffix ?? ""} · ${[listingFacts(top), top.street].filter(Boolean).join(" · ")}`
      : input.searchName,
    eyebrow: "Saved search",
    heading,
    intro: `${INTRO[input.frequency]} “${input.searchName}”.`,
    blocks,
    cta: { label: "View your search", href: input.searchUrl },
    reason: `You're getting ${input.frequency === "instant" ? "instant" : input.frequency} alerts because you saved the search “${input.searchName}” on ${site.name}.`,
    unsubscribe: { label: "Unsubscribe from this search", href: input.unsubscribeUrl },
    manage: { label: "Manage alerts", href: input.manageUrl },
    disclaimers: input.disclaimers,
    mlsCredit: true,
  });
}

/** Price and status changes on a user's saved homes — one email per user per run. */
export function savedHomesUpdateEmail(input: {
  homes: EmailListing[];
  savedUrl: string;
  unsubscribeUrl: string;
  manageUrl: string;
  disclaimers?: string[];
}): RenderedEmail {
  const { homes } = input;
  const first = homes[0];
  const subject =
    homes.length === 1
      ? `${first.badge?.label ?? "Update"}: ${first.street}`
      : `Updates on ${homes.length} of your saved homes`;
  return renderEmail({
    subject,
    preheader:
      homes.length === 1
        ? [first.notes?.[0], first.cityLine].filter(Boolean).join(" · ")
        : homes
            .slice(0, 3)
            .map((h) => `${h.street}: ${h.badge?.label ?? "updated"}`)
            .join(" · "),
    eyebrow: "Saved homes",
    heading:
      homes.length === 1 ? "News on a home you saved" : `News on ${homes.length} homes you saved`,
    intro: "Here's what changed since we last wrote.",
    blocks: homes.map(listingRow),
    cta: { label: "See your saved homes", href: input.savedUrl },
    reason: `You're getting this because you saved ${homes.length === 1 ? "this home" : "these homes"} on ${site.name} with price and status updates turned on.`,
    unsubscribe: { label: "Stop saved-home updates", href: input.unsubscribeUrl },
    manage: { label: "Email settings", href: input.manageUrl },
    disclaimers: input.disclaimers,
    mlsCredit: true,
  });
}

const LEAD_EYEBROW: Record<string, string> = {
  tour: "Tour request",
  valuation: "Valuation request",
  offer: "Offer inquiry",
  question: "New question",
  general: "New lead",
};

/** Internal notification to the assigned agent (or the brokerage inbox) about a new lead. */
export function leadNotificationEmail(input: {
  subject: string;
  type: string;
  name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  /** Formatted in the market time zone. */
  tourLabel?: string | null;
  tourType?: "in_person" | "video" | null;
  /** The address a seller typed on a valuation request. */
  propertyAddress?: string | null;
  listing?: EmailListing | null;
  /**
   * How the heading names the home: its street, or "a home in Royston, GA
   * 30662" when the seller withheld the address.
   */
  listingPlace?: string | null;
  source: string;
  /** The lead's own page in the dashboard (/dashboard/leads/<id>), where Call and Text are. */
  dashboardUrl: string;
  /** Null when the lead went to the brokerage inbox for routing. */
  assignedAgentName?: string | null;
  /**
   * Who this copy is for: the person it was sent to (default); the broker's
   * copy of a lead that went to someone else; or an agent a lead was just
   * assigned to by `assignedByName`.
   */
  audience?: "recipient" | "copy" | "assigned";
  assignedByName?: string | null;
  /** Dashboard → Email settings, where the broker turns copies off. */
  settingsUrl?: string;
}): RenderedEmail {
  const where = input.listingPlace;
  const heading =
    input.type === "tour"
      ? `${input.name} wants to tour ${where ?? "a home"}`
      : input.type === "valuation"
        ? `${input.name} wants a home valuation`
        : where
          ? `${input.name} asked about ${where}`
          : `New message from ${input.name}`;
  const phoneDigits = input.phone?.replace(/[^\d+]/g, "");

  const blocks: EmailBlock[] = [
    detailsTable([
      { label: "Name", value: input.name },
      { label: "Email", value: input.email, href: `mailto:${input.email}` },
      { label: "Phone", value: input.phone, href: phoneDigits ? `tel:${phoneDigits}` : undefined },
      { label: "Requested tour", value: input.tourLabel },
      {
        label: "Tour type",
        value: input.tourType ? (input.tourType === "video" ? "Video tour" : "In person") : null,
      },
      { label: "Property", value: input.propertyAddress },
      {
        label: "Sent from",
        value: `${input.source.charAt(0).toUpperCase()}${input.source.slice(1)} page`,
      },
    ]),
  ];
  if (input.message) blocks.push(quote(input.message));
  if (input.listing) blocks.push(sectionTitle("Home"), listingRow(input.listing));

  const first = input.name.split(" ")[0];
  const audience = input.audience ?? "recipient";
  const intro =
    audience === "assigned"
      ? `${input.assignedByName ?? "Your broker"} assigned this lead to you. Reply to this email to answer ${first} directly.`
      : audience === "copy"
        ? input.assignedAgentName
          ? `Your copy: this lead went to ${input.assignedAgentName}.`
          : "Your copy: this lead went to the office inbox and isn't assigned to an agent yet. Route it from the dashboard."
        : input.assignedAgentName
          ? `Assigned to ${input.assignedAgentName}. Reply to this email to answer ${first} directly.`
          : "This lead isn't assigned to an agent yet — route it from the dashboard.";

  return renderEmail({
    subject: audience === "assigned" ? `Assigned to you: ${input.subject}` : input.subject,
    preheader: [input.name, input.tourLabel, input.message?.slice(0, 80)]
      .filter(Boolean)
      .join(" · "),
    eyebrow: audience === "assigned" ? "Assigned to you" : (LEAD_EYEBROW[input.type] ?? "New lead"),
    heading,
    intro,
    blocks,
    cta: { label: "Open this lead", href: input.dashboardUrl },
    afterCta:
      audience === "copy" && input.settingsUrl
        ? [
            paragraph(
              "You get a copy of every new lead because “Copy me on every new lead” is on.",
              "muted",
            ),
            textLink("Turn copies off in Email settings", input.settingsUrl),
          ]
        : undefined,
    reason: `Leads are private to ${site.legalName} — please don't forward them outside the company.`,
  });
}

/** One lead in the morning summary. */
export type DigestLead = {
  name: string;
  /** e.g. "Tour · 123 Main St, Royston · Emily Cooper". */
  detail: string;
  /** Shown in red, e.g. "Waiting 4 days" or "Was due Sep 27". */
  alert?: string | null;
  /** The lead's own page in the dashboard. */
  href: string;
};

/** A list of leads, each a link to its page, with an optional red note. */
function leadList(items: DigestLead[]): EmailBlock {
  const cells = items
    .map(
      (l, i) => `<tr><td style="padding:12px 0;${i ? `border-top:1px solid ${C.line};` : ""}">
<a href="${esc(l.href)}" style="font-size:16px;font-weight:600;color:${C.brand};text-decoration:none;">${esc(l.name)}</a>${
        l.alert
          ? ` <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:${C.clayTint};color:${C.clay};font-size:12px;font-weight:700;">${esc(l.alert)}</span>`
          : ""
      }
<div style="margin-top:2px;font-size:14px;line-height:1.5;color:${C.muted};">${esc(l.detail)}</div></td></tr>`,
    )
    .join("");
  return {
    html: row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cells}</table>`,
      "4px 40px",
    ),
    text: items
      .map((l) => `- ${l.name}${l.alert ? ` (${l.alert})` : ""}\n  ${l.detail}\n  ${l.href}`)
      .join("\n"),
  };
}

export type DigestSection = {
  title: string;
  items: DigestLead[];
  /** All matching leads; more than `items.length` adds a "see all" line. */
  total: number;
};

/**
 * The 7 a.m. "needs attention" summary (src/lib/leads/digest.ts): one agent's
 * leads, or the whole office's for the broker. Only sent when a section has
 * something in it.
 */
export function leadDigestEmail(input: {
  /** "Emily" for an agent, "Andrea" for the broker. */
  firstName: string;
  office: boolean;
  /** e.g. "Tuesday, September 29". */
  dateLabel: string;
  waiting: DigestSection;
  tours: DigestSection;
  followUps: DigestSection;
  waitRule: string;
  dashboardUrl: string;
  settingsUrl: string;
}): RenderedEmail {
  const sections = [input.waiting, input.tours, input.followUps];
  const counts = [
    input.waiting.total && plural(input.waiting.total, "lead") + " waiting",
    input.tours.total && plural(input.tours.total, "tour"),
    input.followUps.total && plural(input.followUps.total, "follow-up"),
  ].filter(Boolean) as string[];
  const blocks: EmailBlock[] = [];
  for (const s of sections) {
    if (!s.total) continue;
    blocks.push(sectionTitle(s.title, s.total), leadList(s.items));
    if (s.total > s.items.length)
      blocks.push(textLink(`See all ${s.total} in the dashboard`, input.dashboardUrl));
  }
  return renderEmail({
    subject: `Today: ${counts.join(", ")}`,
    preheader: counts.join(" · "),
    eyebrow: input.office ? "Office summary" : "Your morning summary",
    heading: `Good morning, ${input.firstName}`,
    intro: `${input.office ? "What needs attention across the office" : "What needs your attention"} on ${input.dateLabel}. A new lead is waiting too long after ${input.waitRule}.`,
    blocks,
    cta: { label: "Open the dashboard", href: input.dashboardUrl },
    afterCta: [textLink("Change which emails you get", input.settingsUrl)],
    reason: `Leads are private to ${site.legalName} — please don't forward them outside the company.`,
  });
}

export function passwordResetEmail(input: { name: string; url: string }): RenderedEmail {
  const first = input.name.split(" ")[0] || "there";
  return renderEmail({
    subject: `Reset your ${site.name} password`,
    preheader: "Use this link within an hour to choose a new password.",
    heading: "Reset your password",
    intro: `Hi ${first}, we received a request to reset the password for your ${site.name} account.`,
    cta: { label: "Choose a new password", href: input.url },
    afterCta: [
      paragraph(
        "The link expires in one hour. If you didn't ask for this, you can ignore this email — your password won't change.",
        "muted",
      ),
      {
        html: row(
          `<p style="margin:0;font-size:12px;line-height:1.6;color:${C.faint};word-break:break-all;">Button not working? Paste this link into your browser:<br><a href="${esc(input.url)}" style="color:${C.brand};">${esc(input.url)}</a></p>`,
          "4px 40px",
        ),
        text: "",
      },
    ],
    reason: `This is a one-time account email from ${site.name}.`,
  });
}
