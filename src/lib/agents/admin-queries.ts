import { and, asc, desc, eq, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { agents, offices, users } from "@/db/schema";
import { slugify } from "@/lib/listings/slug";

/**
 * Agent profile management for the dashboard: admin queries, plus the pure
 * input parsing shared by the agent server actions (unit-tested).
 */

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every agent profile, active or not, for the admin table. Active first, then public order. */
export async function getAgentsForAdmin() {
  return db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      title: agents.title,
      email: agents.email,
      phone: agents.phone,
      photoUrl: agents.photoUrl,
      isActive: agents.isActive,
      sortOrder: agents.sortOrder,
      loginEmail: users.email,
      activeListings: sql<number>`(
        select count(*)::int from listings l
        where l.list_agent_id = "agents"."id" and l.removed_at is null
          and l.status in ('active', 'coming_soon')
      )`,
    })
    .from(agents)
    .leftJoin(users, eq(agents.userId, users.id))
    .orderBy(desc(agents.isActive), asc(agents.sortOrder), asc(agents.name));
}

/** One profile with its linked login and office (if any), for the edit forms. */
export async function getAgentForEdit(id: string) {
  const [row] = await db
    .select({ agent: agents, loginEmail: users.email, officeName: offices.name })
    .from(agents)
    .leftJoin(users, eq(agents.userId, users.id))
    .leftJoin(offices, eq(agents.officeId, offices.id))
    .where(eq(agents.id, id))
    .limit(1);
  return row ?? null;
}

/** New profiles go to the end of the public list by default. */
export async function getNextSortOrder(): Promise<number> {
  const [row] = await db
    .select({ next: sql<number>`coalesce(max(${agents.sortOrder}) + 1, 0)::int` })
    .from(agents);
  return Math.min(row?.next ?? 0, 9_999);
}

export async function getOfficeOptions() {
  return db
    .select({ id: offices.id, name: offices.name, city: offices.city })
    .from(offices)
    .orderBy(asc(offices.name));
}

/** Slugs other agents already use that could collide with `base` (`base` itself or `base-N`). */
export async function findTakenSlugs(
  base: string,
  excludeId?: string,
  executor: Executor = db,
): Promise<Set<string>> {
  // `base` comes from slugify, so it holds only [a-z0-9-] and needs no LIKE escaping.
  const rows = await executor
    .select({ slug: agents.slug })
    .from(agents)
    .where(
      and(
        or(eq(agents.slug, base), like(agents.slug, `${base}-%`)),
        excludeId ? ne(agents.id, excludeId) : undefined,
      ),
    );
  return new Set(rows.map((r) => r.slug));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Just the editable fields of a profile row, for handing to the (client) agent form. */
export function toAgentFormValues(a: typeof agents.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    title: a.title,
    email: a.email,
    phone: a.phone,
    bio: a.bio,
    photoUrl: a.photoUrl,
    licenseNumber: a.licenseNumber,
    mlsAgentId: a.mlsAgentId,
    specialties: a.specialties,
    languages: a.languages,
    serviceAreas: a.serviceAreas,
    yearsExperience: a.yearsExperience,
    officeId: a.officeId,
    isActive: a.isActive,
    sortOrder: a.sortOrder,
  };
}

/** URL-safe slug stem for `/agents/<slug>`; falls back to "agent" for names slugify can't spell. */
export function toSlugBase(s: string): string {
  return slugify(s).slice(0, 60).replace(/-+$/, "") || "agent";
}

/** `base` if it's free, else the first free `base-2`, `base-3`, … */
export function nextAvailableSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** "Royston, lake hartwell,, Royston" → ["Royston", "lake hartwell"] (trimmed, de-duplicated). */
export function splitList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (value ?? "").split(/[,\n]/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** US numbers are stored as (706) 555-0142 so every profile reads the same; others are kept as typed. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (d.length === 10 && !/x|ext/i.test(raw)) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Field-by-field changes for the audit log. Long free text is recorded as
 * edited rather than copied, so the log stays small.
 */
export function diffProfile(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to ?? null)) continue;
    changes[key] = key === "bio" ? "edited" : { from, to: to ?? null };
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .optional()
    .transform((v) => v || null);

const optionalInt = (min: number, max: number, message: string) =>
  z
    .preprocess(
      blankToUndefined,
      z.coerce.number(message).int(message).min(min, message).max(max, message).optional(),
    )
    .transform((v) => v ?? null);

const MAX_LIST_ITEMS = 12;
const MAX_ITEM_LENGTH = 60;

const listField = z
  .string()
  .max(2_000, "That list is too long.")
  .optional()
  .transform(splitList)
  .refine((items) => items.length <= MAX_LIST_ITEMS, `List up to ${MAX_LIST_ITEMS} items.`)
  .refine(
    (items) => items.every((i) => i.length <= MAX_ITEM_LENGTH),
    `Keep each item under ${MAX_ITEM_LENGTH} characters.`,
  );

/** Digits and the usual separators, with an optional "x123" / "ext. 123" extension. */
const PHONE_PATTERN = /^\+?[\d\s().-]+(\s*(x|ext\.?)\s*\d{1,6})?$/i;

const isHttpsUrl = (v: string) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/** Fields an agent may edit on their own public profile. */
const selfFields = {
  name: z
    .string()
    .trim()
    .min(2, "Enter the full name shown on the profile.")
    .max(100, "Keep it under 100 characters."),
  title: optionalText(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(200)),
  phone: z
    .string()
    .trim()
    .max(40, "Enter a valid phone number.")
    .optional()
    .refine(
      (v) => !v || (PHONE_PATTERN.test(v) && v.replace(/\D/g, "").length >= 10),
      "Enter a phone number with area code.",
    )
    .transform((v) => (v ? formatPhone(v) : null)),
  bio: optionalText(4_000),
  photoUrl: z
    .string()
    .trim()
    .max(2_000, "That link is too long.")
    .optional()
    .refine((v) => !v || isHttpsUrl(v), "Use an https:// link to the photo.")
    .transform((v) => v || null),
  licenseNumber: optionalText(40),
  specialties: listField,
  languages: listField,
  serviceAreas: listField,
  yearsExperience: optionalInt(0, 80, "Enter a whole number of years (0–80)."),
};

/** Admin-only fields: public visibility, ordering, URL, office and the MLS link. */
const adminFields = {
  /** Blank means "generate from the name" (create) or "keep the current one" (edit). */
  slug: z
    .string()
    .trim()
    .max(80, "Keep it under 80 characters.")
    .optional()
    .transform((v) => (v && slugify(v) ? toSlugBase(v) : null)),
  mlsAgentId: optionalText(40),
  officeId: z
    .union([z.literal("").transform(() => null), z.uuid("Choose an office from the list.")])
    .optional()
    .transform((v) => v ?? null),
  sortOrder: optionalInt(0, 9_999, "Enter a whole number from 0 to 9999.").transform((v) => v ?? 0),
  isActive: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
};

// z.object strips unknown keys, so admin-only fields posted to the self-service
// form never reach the database.
const selfProfileSchema = z.object(selfFields);
const adminProfileSchema = z.object({ ...selfFields, ...adminFields });

export type SelfProfileInput = z.infer<typeof selfProfileSchema>;
export type AdminProfileInput = z.infer<typeof adminProfileSchema>;
export type AgentFieldErrors = Partial<Record<string, string>>;

type Parsed<T> = { ok: true; data: T } | { ok: false; errors: AgentFieldErrors };

function parseWith<T>(schema: z.ZodType<T>, input: Record<string, unknown>): Parsed<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: AgentFieldErrors = {};
  for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  return { ok: false, errors };
}

/** What an agent may change about themselves. Admin-only keys in `input` are ignored. */
export function parseSelfProfile(input: Record<string, unknown>): Parsed<SelfProfileInput> {
  return parseWith(selfProfileSchema, input);
}

/** The full profile, for admins. */
export function parseAdminProfile(input: Record<string, unknown>): Parsed<AdminProfileInput> {
  return parseWith(adminProfileSchema, input);
}
