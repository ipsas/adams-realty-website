"use client";

import { CalendarPlus, ChevronRight, Trash2, Video } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import {
  addOpenHouse,
  deleteOpenHouse,
  type OpenHouseInput,
  type OpenHouseResult,
} from "@/server/actions/open-houses";

/** An open house with its labels pre-formatted on the server (market time zone). */
export type OpenHouseRow = {
  id: string;
  type: "in_person" | "virtual";
  remarks: string | null;
  /** "Sat, Oct 3, 1–3 PM" */
  label: string;
  month: string;
  day: string;
  /** "Sat · 1–3 PM" */
  when: string;
  /** How listing cards show it: "Open Sat 1pm". */
  badge: string;
  phase: "upcoming" | "live" | "past";
};

/** 7:00 AM – 9:00 PM in 15-minute steps, as HH:MM values with 12-hour labels. */
const TIMES = Array.from({ length: 57 }, (_, i) => {
  const minutes = 7 * 60 + i * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const label = `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return [value, label] as const;
});

const PAST_SHOWN = 8;

// Inputs stay at 16px on phones so iOS doesn't zoom into them.
const control = "text-base sm:text-sm";

export function OpenHouseManager({
  listingId,
  openHouses,
  defaultDate,
  minDate,
  timeZoneLabel,
  blockedReason,
}: {
  listingId: string;
  openHouses: OpenHouseRow[];
  defaultDate: string;
  minDate: string;
  timeZoneLabel: string;
  /** Why new open houses can't be scheduled (sold / off market), if they can't. */
  blockedReason: string | null;
}) {
  const [form, setForm] = useState<OpenHouseInput>({
    date: defaultDate,
    startTime: "13:00",
    endTime: "15:00",
    type: "in_person",
    remarks: "",
  });
  const [result, setResult] = useState<OpenHouseResult | null>(null);
  const [adding, startAdding] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startRemoving] = useTransition();
  const ids = useId();

  const current = openHouses.filter((o) => o.phase !== "past");
  const past = openHouses.filter((o) => o.phase === "past");
  const errors = result?.errors ?? {};
  const set = (patch: Partial<OpenHouseInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (result?.errors) setResult(null);
  };

  function remove(o: OpenHouseRow) {
    if (!confirm(`Remove the open house on ${o.label}? It comes off the site right away.`)) return;
    setRemovingId(o.id);
    startRemoving(async () => {
      const res = await deleteOpenHouse(o.id);
      setResult(res);
      setRemovingId(null);
    });
  }

  const list = (rows: OpenHouseRow[]) => (
    <ul className="divide-y divide-line">
      {rows.map((o) => (
        <li
          key={o.id}
          className={cn(
            "flex items-center gap-3 py-3 transition-opacity",
            removingId === o.id && "opacity-40",
          )}
        >
          <div
            aria-hidden
            className={cn(
              "flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5",
              o.phase === "past" ? "bg-sunken text-muted" : "bg-brass-100 text-brass-700",
            )}
          >
            <span className="text-[0.6875rem] font-semibold tracking-wider uppercase">
              {o.month}
            </span>
            <span
              className={cn(
                "text-lg leading-tight font-semibold tabular",
                o.phase === "past" ? "text-muted" : "text-ink",
              )}
            >
              {o.day}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn("text-sm font-medium", o.phase === "past" ? "text-muted" : "text-ink")}
            >
              <span className="sr-only">{o.label}</span>
              <span aria-hidden>{o.when}</span>
              {o.phase === "live" && (
                <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
                  Happening now
                </span>
              )}
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
              {o.type === "virtual" ? (
                <>
                  <Video className="size-3.5 shrink-0" aria-hidden /> Virtual
                </>
              ) : (
                "In person"
              )}
              {o.remarks && <span className="truncate"> · {o.remarks}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => remove(o)}
            disabled={removingId !== null}
            aria-label={`Remove open house on ${o.label}`}
            title="Remove open house"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-clay-50 hover:text-clay-600 focus-visible:ring-3 focus-visible:ring-brand-100 focus-visible:outline-none disabled:opacity-40"
          >
            <Trash2 className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <section
      id="open-houses"
      aria-labelledby={`${ids}-title`}
      className="@container scroll-mt-24 rounded-3xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id={`${ids}-title`} className="text-base font-semibold text-ink">
        Open houses
      </h2>
      <p className="mt-1 text-sm text-muted">
        Times are {timeZoneLabel}. Changes go live right away; you don&apos;t need to save the
        listing.
      </p>

      {/* A narrow sidebar stacks everything; given room, the schedule form sits beside the list. */}
      <div className="mt-4 grid grid-cols-1 gap-x-10 @[44rem]:grid-cols-2">
        <div className="min-w-0">
          {current.length === 0 ? (
            <p className="rounded-2xl bg-sunken px-4 py-5 text-center text-sm text-muted">
              No upcoming open houses.
            </p>
          ) : (
            <>
              {list(current)}
              <p className="mt-1 text-xs text-muted">
                Listing cards show the next one as{" "}
                <span className="rounded-full bg-brass-100 px-2 py-0.5 font-medium whitespace-nowrap text-brass-700">
                  {current[0].badge}
                </span>
              </p>
            </>
          )}

          {result?.message && !adding && (
            <div className="mt-4">
              <FormMessage tone={result.ok ? "success" : "error"}>{result.message}</FormMessage>
            </div>
          )}
        </div>

        <div className="min-w-0 @[44rem]:row-span-2">
          {blockedReason ? (
            <p className="mt-5 rounded-2xl border border-line px-4 py-3 text-sm text-muted @[44rem]:mt-0">
              {blockedReason}
            </p>
          ) : (
            <form
              noValidate
              aria-labelledby={`${ids}-add-title`}
              className="mt-5 border-t border-line pt-5 @[44rem]:mt-0 @[44rem]:border-t-0 @[44rem]:border-l @[44rem]:pt-0 @[44rem]:pl-10"
              onSubmit={(e) => {
                e.preventDefault();
                startAdding(async () => {
                  const res = await addOpenHouse(listingId, form);
                  setResult(res);
                  if (res.ok) setForm((f) => ({ ...f, remarks: "" }));
                });
              }}
            >
              <h3 id={`${ids}-add-title`} className="text-sm font-semibold text-ink">
                Schedule an open house
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field
                  label="Date"
                  htmlFor={`${ids}-date`}
                  error={errors.date}
                  className="col-span-2"
                >
                  <Input
                    id={`${ids}-date`}
                    type="date"
                    min={minDate}
                    value={form.date}
                    onChange={(e) => set({ date: e.target.value })}
                    aria-invalid={errors.date ? true : undefined}
                    required
                    className={control}
                  />
                </Field>
                <Field label="Starts" htmlFor={`${ids}-start`} error={errors.startTime}>
                  <Select
                    id={`${ids}-start`}
                    value={form.startTime}
                    onChange={(e) => set({ startTime: e.target.value })}
                    aria-invalid={errors.startTime ? true : undefined}
                    className={control}
                  >
                    {TIMES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ends" htmlFor={`${ids}-end`} error={errors.endTime}>
                  <Select
                    id={`${ids}-end`}
                    value={form.endTime}
                    onChange={(e) => set({ endTime: e.target.value })}
                    aria-invalid={errors.endTime ? true : undefined}
                    className={control}
                  >
                    {TIMES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <fieldset className="mt-3">
                <legend className="text-sm font-medium text-ink-soft">Format</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1">
                  {(
                    [
                      ["in_person", "In person"],
                      ["virtual", "Virtual"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={cn(
                        "flex h-10 cursor-pointer items-center justify-center rounded-lg text-sm font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-brand-100",
                        form.type === value
                          ? "bg-surface text-ink shadow-sm"
                          : "text-ink-soft hover:text-ink",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${ids}-type`}
                        value={value}
                        checked={form.type === value}
                        onChange={() => set({ type: value })}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <Field
                label="Remarks (optional)"
                htmlFor={`${ids}-remarks`}
                error={errors.remarks}
                hint={
                  form.type === "virtual"
                    ? "Include the meeting link so visitors can join."
                    : "Shown next to the time on the property page."
                }
                className="mt-3"
              >
                <Input
                  id={`${ids}-remarks`}
                  value={form.remarks}
                  maxLength={200}
                  onChange={(e) => set({ remarks: e.target.value })}
                  placeholder={form.type === "virtual" ? "https://…" : "e.g. Park on the street"}
                  aria-invalid={errors.remarks ? true : undefined}
                  className={control}
                />
              </Field>

              <Button type="submit" disabled={adding} className="mt-4 w-full">
                <CalendarPlus /> {adding ? "Adding…" : "Add open house"}
              </Button>
            </form>
          )}
        </div>

        {past.length > 0 && (
          <details className="group mt-5 min-w-0 border-t border-line pt-4">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-4 transition-transform group-open:rotate-90"
                aria-hidden
              />
              Past open houses ({past.length})
            </summary>
            {list(past.slice(0, PAST_SHOWN))}
            {past.length > PAST_SHOWN && (
              <p className="pt-2 text-xs text-muted">And {past.length - PAST_SHOWN} earlier.</p>
            )}
          </details>
        )}
      </div>
    </section>
  );
}
