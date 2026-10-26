"use client";

import { CheckCircle2 } from "lucide-react";
import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/form";
import { Honeypot, useFormTimer } from "@/components/ui/spam-guard";
import { catchSendFailure } from "@/lib/leads/send";
import { createInquiry, type InquiryState } from "@/server/actions/inquiries";

const sendInquiry = catchSendFailure(createInquiry);

export function ValuationForm() {
  const [state, action, pending] = useActionState<InquiryState, FormData>(sendInquiry, {
    ok: false,
  });
  const stamp = useFormTimer();
  if (state.ok) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <CheckCircle2 className="size-12 text-brand-600" strokeWidth={1.5} />
        <p className="mt-4 text-lg font-semibold text-ink">{state.message}</p>
        <p className="mt-1 text-sm text-muted">
          We&apos;ll look at recent sales nearby and get back to you with your valuation.
        </p>
      </div>
    );
  }
  return (
    <form
      // Sent from onSubmit, not <form action>, so React doesn't reset what was typed. The
      // browser checks the fields first; the timer token is usually in hand already.
      onSubmit={async (e) => {
        e.preventDefault();
        const stamped = await stamp(new FormData(e.currentTarget));
        startTransition(() => action(stamped));
      }}
      className="space-y-4"
    >
      <input type="hidden" name="type" value="valuation" />
      <input type="hidden" name="source" value="sell" />
      <Honeypot />
      <Field label="Property address" htmlFor="v-address" error={state.errors?.address}>
        <Input
          id="v-address"
          name="address"
          autoComplete="street-address"
          placeholder="Street address, town and ZIP"
          required
          maxLength={300}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="v-name" error={state.errors?.name}>
          <Input
            id="v-name"
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            aria-invalid={!!state.errors?.name}
          />
        </Field>
        <Field label="Phone" htmlFor="v-phone">
          <Input id="v-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </Field>
      </div>
      <Field label="Email" htmlFor="v-email" error={state.errors?.email}>
        <Input
          id="v-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={200}
          aria-invalid={!!state.errors?.email}
        />
      </Field>
      <Field label="When are you thinking of selling?" htmlFor="v-timing">
        <Select id="v-timing" name="message" defaultValue="Timing: just curious">
          <option>Timing: just curious</option>
          <option>Timing: within 3 months</option>
          <option>Timing: 3–6 months</option>
          <option>Timing: 6–12 months</option>
        </Select>
      </Field>
      <Field label="Anything else? (optional)" htmlFor="v-notes">
        <Textarea
          id="v-notes"
          name="notes"
          rows={3}
          maxLength={4000}
          placeholder="Acreage, recent renovations, questions, preferred contact time…"
        />
      </Field>
      <FormMessage>{!state.ok && state.message}</FormMessage>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Get my free valuation"}
      </Button>
      <p className="text-center text-xs text-faint">
        No obligation, no automated “estimate” emails, never shared.
      </p>
    </form>
  );
}
