"use server";

import { headers } from "next/headers";
import { site } from "@/config/site";
import { db } from "@/db";
import { clientIp } from "@/lib/anti-scraping";
import { getSession } from "@/lib/auth/session";
import { sendTransactional } from "@/lib/email";
import { env } from "@/lib/env";
import { afterResponse } from "@/lib/leads/deliver";
import { submitInquiry, type InquiryState } from "@/lib/leads/submit";

export type { InquiryState };

/**
 * Public lead form handler (tour requests, questions, valuations, listing
 * reports). Validation, spam checks, storage and the notification live in
 * `submitInquiry` (src/lib/leads/submit.ts); this adds the request's details
 * and sends the emails after the response (`afterResponse`, Next's `after()`).
 */
export async function createInquiry(_prev: InquiryState, form: FormData): Promise<InquiryState> {
  const raw = Object.fromEntries(
    [...form.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]),
  );
  const h = await headers();
  const session = await getSession();
  const { ok, message, errors } = await submitInquiry(
    raw,
    {
      ip: clientIp(h),
      userId: session?.user.id ?? null,
      referer: h.get("referer") ?? "",
      userAgent: h.get("user-agent") ?? "",
    },
    {
      db,
      // Retried in the request; a notice that still fails is queued for the cron.
      send: sendTransactional,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
      inbox: env.LEADS_INBOX ?? site.email,
      // The emails finish after the thank-you is sent, and the function waits for them.
      defer: (task) => afterResponse("inquiry emails", task),
    },
  );
  return { ok, message, errors };
}
