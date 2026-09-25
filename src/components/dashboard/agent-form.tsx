"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { slugify } from "@/lib/listings/slug";
import {
  createAgent,
  setAgentActive,
  updateAgent,
  updateMyProfile,
  type AgentFormState,
} from "@/server/actions/agents";

export type AgentFormValues = {
  id?: string;
  name: string;
  slug: string;
  title: string | null;
  email: string;
  phone: string | null;
  bio: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
  mlsAgentId: string | null;
  specialties: string[];
  languages: string[];
  serviceAreas: string[];
  yearsExperience: number | null;
  officeId: string | null;
  isActive: boolean;
  sortOrder: number;
};

/** `create`/`edit` are the admin forms; `self` is an agent editing their own profile. */
type Mode = "create" | "edit" | "self";

const ACTIONS = { create: createAgent, edit: updateAgent, self: updateMyProfile } as const;

const NO_FIELDS: ReadonlySet<string> = new Set();

// Inputs stay at 16px on phones so iOS doesn't zoom into them.
const control = "text-base sm:text-sm";

export function AgentForm({
  mode,
  values,
  offices = [],
  cancelHref,
}: {
  mode: Mode;
  values: AgentFormValues;
  offices?: { id: string; name: string; city: string | null }[];
  cancelHref: string;
}) {
  const [state, dispatch, pending] = useActionState<AgentFormState, FormData>(
    async (prev, data) => {
      const next = await ACTIONS[mode](prev, data);
      // Keep the last save's stamp through failed attempts so fields aren't remounted.
      return { ...next, savedAt: next.savedAt ?? prev.savedAt };
    },
    { ok: false },
  );
  const formRef = useRef<HTMLFormElement>(null);

  // A field's error is hidden once the user edits it, until the next submit.
  const [edited, setEdited] = useState<{ after: AgentFormState; fields: ReadonlySet<string> }>({
    after: state,
    fields: new Set(),
  });
  const editedFields = edited.after === state ? edited.fields : NO_FIELDS;
  const errors = Object.fromEntries(
    Object.entries(state.errors ?? {}).filter(([field]) => !editedFields.has(field)),
  );

  // Take the user to the first field that needs fixing.
  useEffect(() => {
    if (!state.errors) return;
    const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]");
    first?.focus();
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);

  return (
    <form
      ref={formRef}
      noValidate
      // Submitting through a transition (instead of `action=`) keeps what the
      // user typed when validation fails; React would otherwise reset the form.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => dispatch(data));
      }}
      onInput={(e) => {
        const field = (e.target as HTMLInputElement).name;
        if (!field || !state.errors?.[field] || editedFields.has(field)) return;
        setEdited({ after: state, fields: new Set(editedFields).add(field) });
      }}
    >
      {/* Remount after a save so fields show the stored, normalized values. */}
      <AgentFields
        key={state.savedAt ?? 0}
        mode={mode}
        values={values}
        offices={offices}
        errors={errors}
      />
      <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex flex-wrap items-center gap-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Button type="submit" size="lg" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Create profile"
              : mode === "self"
                ? "Save my profile"
                : "Save changes"}
        </Button>
        <Link href={cancelHref} className={buttonClasses("ghost", "lg")}>
          {mode === "self" ? "Back to overview" : "Cancel"}
        </Link>
        {state.message && !pending && (
          <FormMessage tone={state.ok ? "success" : "error"}>{state.message}</FormMessage>
        )}
      </div>
    </form>
  );
}

function AgentFields({
  mode,
  values: v,
  offices,
  errors: e,
}: {
  mode: Mode;
  values: AgentFormValues;
  offices: { id: string; name: string; city: string | null }[];
  errors: Partial<Record<string, string>>;
}) {
  const admin = mode !== "self";
  const [name, setName] = useState(v.name);
  const [title, setTitle] = useState(v.title ?? "");
  const [areas, setAreas] = useState(v.serviceAreas.join(", "));
  const [isActive, setIsActive] = useState(v.isActive);
  const [photoInput, setPhotoInput] = useState(v.photoUrl ?? "");
  const photo = useDebounced(photoInput.trim(), 400);
  const photoSrc = /^https:\/\/\S+$/.test(photo) ? photo : null;

  // New profiles take their URL from the name until the admin types one.
  const [slug, setSlug] = useState(v.slug);
  const [slugEdited, setSlugEdited] = useState(mode !== "create");
  const slugShown = slugPreview(slug) || slugPreview(name);

  const invalid = (field: string) => (e[field] ? true : undefined);
  const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const listHint = (example: string) => `Separate with commas, e.g. ${example}.`;

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-8">
        {v.id && mode === "edit" && <input type="hidden" name="id" value={v.id} />}

        <Group
          title="Profile"
          description={
            admin ? undefined : "This is what buyers and sellers see on your public page."
          }
        >
          <Field label="Full name" htmlFor="name" error={e.name}>
            <Input
              id="name"
              name="name"
              defaultValue={v.name}
              required
              autoComplete="off"
              aria-invalid={invalid("name")}
              className={control}
              onChange={(ev) => {
                setName(ev.target.value);
                if (!slugEdited) setSlug(slugPreview(ev.target.value));
              }}
            />
          </Field>
          <Field label="Title" htmlFor="title" error={e.title} hint="e.g. Associate Broker">
            <Input
              id="title"
              name="title"
              defaultValue={v.title ?? ""}
              maxLength={80}
              aria-invalid={invalid("title")}
              className={control}
              onChange={(ev) => setTitle(ev.target.value)}
            />
          </Field>
          {admin && (
            <Field
              label="Profile URL"
              htmlFor="slug"
              error={e.slug}
              className="sm:col-span-2"
              hint={
                <>
                  Public page:{" "}
                  <span className="font-medium text-ink-soft">/agents/{slugShown}</span>
                  {mode === "edit"
                    ? " · Changing it breaks links people have already shared."
                    : " · Filled in from the name; a number is added if it's taken."}
                </>
              }
            >
              <Input
                id="slug"
                name="slug"
                value={slug}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid("slug")}
                className={control}
                onChange={(ev) => {
                  setSlug(ev.target.value);
                  setSlugEdited(mode !== "create" || ev.target.value !== "");
                }}
              />
            </Field>
          )}
          <Field
            label="Photo URL"
            htmlFor="photoUrl"
            error={e.photoUrl}
            className="sm:col-span-2"
            hint="An https:// link to a portrait headshot. Leave blank to show initials."
          >
            <div className="flex items-center gap-3">
              <Avatar
                key={photoSrc ?? "none"}
                src={photoSrc}
                name={name.trim() || "New agent"}
                className="size-11 shrink-0 rounded-full text-sm"
              />
              <Input
                id="photoUrl"
                name="photoUrl"
                type="url"
                inputMode="url"
                defaultValue={v.photoUrl ?? ""}
                placeholder="https://"
                spellCheck={false}
                aria-invalid={invalid("photoUrl")}
                className={control}
                onChange={(ev) => setPhotoInput(ev.target.value)}
              />
            </div>
          </Field>
          <Field
            label="Bio"
            htmlFor="bio"
            error={e.bio}
            className="sm:col-span-2"
            hint="A few short paragraphs: the neighborhoods you know, how you work, what clients can expect."
          >
            <Textarea
              id="bio"
              name="bio"
              rows={7}
              defaultValue={v.bio ?? ""}
              maxLength={4000}
              aria-invalid={invalid("bio")}
              className={control}
            />
          </Field>
        </Group>

        <Group title="Contact" description="Shown on the public profile.">
          <Field label="Email" htmlFor="email" error={e.email}>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              defaultValue={v.email}
              required
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid("email")}
              className={control}
            />
          </Field>
          <Field label="Phone" htmlFor="phone" error={e.phone}>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={v.phone ?? ""}
              autoComplete="off"
              aria-invalid={invalid("phone")}
              className={control}
            />
          </Field>
        </Group>

        <Group title="Expertise">
          <Field
            label="Specialties"
            htmlFor="specialties"
            error={e.specialties}
            className="sm:col-span-2"
            hint={listHint("First-time buyers, Relocation, New construction")}
          >
            <Input
              id="specialties"
              name="specialties"
              defaultValue={v.specialties.join(", ")}
              aria-invalid={invalid("specialties")}
              className={control}
            />
          </Field>
          <Field
            label="Neighborhoods served"
            htmlFor="serviceAreas"
            error={e.serviceAreas}
            className="sm:col-span-2"
            hint={listHint("Decatur, Kirkwood, East Atlanta")}
          >
            <Input
              id="serviceAreas"
              name="serviceAreas"
              defaultValue={areas}
              aria-invalid={invalid("serviceAreas")}
              className={control}
              onChange={(ev) => setAreas(ev.target.value)}
            />
          </Field>
          <Field
            label="Languages"
            htmlFor="languages"
            error={e.languages}
            hint={listHint("English, Spanish")}
          >
            <Input
              id="languages"
              name="languages"
              defaultValue={v.languages.join(", ")}
              aria-invalid={invalid("languages")}
              className={control}
            />
          </Field>
          <Field label="Years in real estate" htmlFor="yearsExperience" error={e.yearsExperience}>
            <Input
              id="yearsExperience"
              name="yearsExperience"
              type="number"
              inputMode="numeric"
              min={0}
              max={80}
              defaultValue={val(v.yearsExperience)}
              aria-invalid={invalid("yearsExperience")}
              className={control}
            />
          </Field>
        </Group>

        <Group title="Licensing">
          <Field
            label="Real estate license number"
            htmlFor="licenseNumber"
            error={e.licenseNumber}
            hint="Shown in small print on the public profile."
          >
            <Input
              id="licenseNumber"
              name="licenseNumber"
              defaultValue={v.licenseNumber ?? ""}
              autoComplete="off"
              aria-invalid={invalid("licenseNumber")}
              className={control}
            />
          </Field>
          {admin && (
            <Field
              label="MLS agent ID"
              htmlFor="mlsAgentId"
              error={e.mlsAgentId}
              hint="Links this agent's listings in the MLS feed to this profile."
            >
              <Input
                id="mlsAgentId"
                name="mlsAgentId"
                defaultValue={v.mlsAgentId ?? ""}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalid("mlsAgentId")}
                className={control}
              />
            </Field>
          )}
        </Group>

        {admin && (
          <Group title="Office & visibility">
            <Field label="Office" htmlFor="officeId" error={e.officeId}>
              <Select
                id="officeId"
                name="officeId"
                defaultValue={v.officeId ?? ""}
                aria-invalid={invalid("officeId")}
                className={control}
              >
                <option value="">— No office —</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.city ? `${o.name} (${o.city})` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Sort order"
              htmlFor="sortOrder"
              error={e.sortOrder}
              hint="Lower numbers appear first on the Agents page."
            >
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                inputMode="numeric"
                min={0}
                max={9999}
                defaultValue={String(v.sortOrder)}
                aria-invalid={invalid("sortOrder")}
                className={control}
              />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                name="isActive"
                label="Active — show this agent on the public site"
                defaultChecked={v.isActive}
                onChange={(ev) => setIsActive(ev.target.checked)}
                className="min-h-10 font-medium text-ink"
              />
              <p className="mt-1 text-xs text-muted sm:pl-7">
                Inactive agents disappear from the Agents page and their profile URL stops working.
                Their listings and leads stay as they are — change their role under Users &amp;
                roles to remove dashboard access.
              </p>
            </div>
          </Group>
        )}
      </div>

      <aside className="hidden xl:block" aria-label="Preview">
        <div className="sticky top-24">
          <p className="mb-3 text-xs font-semibold tracking-widest text-faint uppercase">
            Agents page preview
          </p>
          <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-card)] bg-sunken">
              <Avatar
                key={photoSrc ?? "none"}
                src={photoSrc}
                name={name.trim() || "New agent"}
                className="size-full text-5xl"
              />
              {admin && !isActive && (
                <span className="absolute top-3 left-3 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-medium text-white">
                  Hidden
                </span>
              )}
            </div>
            <p className="mt-4 truncate text-lg font-semibold text-ink">
              {name.trim() || "Agent name"}
            </p>
            <p className="truncate text-sm text-muted">{title.trim() || "Title"}</p>
            {areas.trim() && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-soft">
                <MapPin className="mt-px size-3.5 shrink-0 text-faint" />
                <span className="line-clamp-2">{areas}</span>
              </p>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Updates as you type. Photos that can&apos;t be loaded fall back to initials.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <legend className="px-2 text-sm font-semibold text-ink">{title}</legend>
      {description && <p className="-mt-1 mb-4 px-0.5 text-sm text-muted">{description}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Mirrors the server's slug rules closely enough for the live hint. */
function slugPreview(s: string) {
  return slugify(s).slice(0, 60).replace(/-+$/, "");
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Row action on the admin table: hide an agent from the public site, or bring them back. */
export function AgentActiveButton({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={
        active
          ? "inline-flex h-10 items-center rounded-lg px-2 text-sm text-muted hover:bg-clay-50 hover:text-clay-600 disabled:opacity-50"
          : "inline-flex h-10 items-center rounded-lg px-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
      }
      onClick={() => {
        if (
          active &&
          !confirm(
            `Hide ${name} from the public site? Their listings, leads and login stay as they are.`,
          )
        )
          return;
        start(async () => {
          await setAgentActive(id, !active);
        });
      }}
    >
      {pending ? "Saving…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
