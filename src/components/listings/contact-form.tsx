"use client";

import { CalendarCheck, CheckCircle2, MessageSquare, Video } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { site } from "@/config/site";
import { cn } from "@/lib/cn";
import { upcomingDays } from "@/lib/time";
import { createInquiry, type InquiryState } from "@/server/actions/inquiries";

const TIMES = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];

function timeLabel(t: string) {
  const [h] = t.split(":").map(Number);
  return `${h % 12 || 12}:00 ${h < 12 ? "am" : "pm"}`;
}

export function ContactForm({
  listingId,
  agentId,
  source,
  allowTour = true,
  defaultMessage,
  user,
  compact = false,
}: {
  listingId?: string;
  agentId?: string;
  source: "listing" | "agent" | "contact" | "report";
  allowTour?: boolean;
  defaultMessage?: string;
  user?: { name: string; email: string; phone?: string | null } | null;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"tour" | "question">(allowTour ? "tour" : "question");
  const [state, action, pending] = useActionState<InquiryState, FormData>(createInquiry, {
    ok: false,
  });
  const days = useMemo(() => upcomingDays(7), []);
  const [day, setDay] = useState(days[0]);
  const [tourType, setTourType] = useState<"in_person" | "video">("in_person");

  if (state.ok) {
    return (
      <div className="flex animate-rise flex-col items-center py-8 text-center">
        <CheckCircle2 className="size-12 text-brand-600" strokeWidth={1.5} />
        <p className="mt-4 text-lg font-semibold text-ink">{state.message ?? "Message sent!"}</p>
        <p className="mt-1 text-sm text-muted">
          We usually reply within the hour during business hours.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="type" value={mode} />
      {listingId && <input type="hidden" name="listingId" value={listingId} />}
      {agentId && <input type="hidden" name="agentId" value={agentId} />}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {allowTour && (
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
          {(
            [
              ["tour", "Request a tour", CalendarCheck],
              ["question", "Ask a question", MessageSquare],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors",
                mode === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === "tour" && (
        <div className="space-y-3">
          <input type="hidden" name="tourDate" value={day} />
          <input type="hidden" name="tourType" value={tourType} />
          <div className="-mx-1 scrollbar-none flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((d) => {
              const date = new Date(`${d}T12:00:00Z`);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={day === d}
                  onClick={() => setDay(d)}
                  className={cn(
                    "flex w-16 shrink-0 flex-col items-center rounded-xl border py-2 transition-colors",
                    day === d
                      ? "border-brand-700 bg-brand-50 text-brand-800"
                      : "border-line-strong text-ink-soft hover:border-faint",
                  )}
                >
                  <span className="text-[11px] font-medium uppercase">
                    {date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                  </span>
                  <span className="text-lg leading-tight font-semibold">{date.getUTCDate()}</span>
                  <span className="text-[11px]">
                    {date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select name="tourTime" aria-label="Preferred time" defaultValue="10:00">
              {TIMES.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => setTourType((t) => (t === "in_person" ? "video" : "in_person"))}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong text-sm font-medium text-ink-soft hover:border-faint"
              aria-label="Toggle tour type"
            >
              {tourType === "video" ? (
                <Video className="size-4" />
              ) : (
                <CalendarCheck className="size-4" />
              )}
              {tourType === "video" ? "Video tour" : "In person"}
            </button>
          </div>
        </div>
      )}

      <div className={cn("grid gap-3", !compact && "sm:grid-cols-2")}>
        <Field label="Name" htmlFor="c-name" error={state.errors?.name}>
          <Input
            id="c-name"
            name="name"
            autoComplete="name"
            defaultValue={user?.name}
            required
            aria-invalid={!!state.errors?.name}
          />
        </Field>
        <Field label="Phone" htmlFor="c-phone" error={state.errors?.phone}>
          <Input
            id="c-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={user?.phone ?? ""}
          />
        </Field>
      </div>
      <Field label="Email" htmlFor="c-email" error={state.errors?.email}>
        <Input
          id="c-email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={user?.email}
          required
          aria-invalid={!!state.errors?.email}
        />
      </Field>
      <Field label="Message" htmlFor="c-message" error={state.errors?.message}>
        <Textarea
          id="c-message"
          name="message"
          rows={3}
          defaultValue={mode === "question" ? defaultMessage : undefined}
          placeholder={
            mode === "tour" ? "Anything we should know? (optional)" : "What would you like to know?"
          }
        />
      </Field>

      <FormMessage>{!state.ok && state.message}</FormMessage>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : mode === "tour" ? "Send tour request" : "Send message"}
      </Button>
      <p className="text-center text-xs leading-relaxed text-faint">
        Your info goes only to {site.name} — never sold or shared. By sending, you agree we may
        contact you about this request.
      </p>
    </form>
  );
}
