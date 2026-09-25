"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyUnsubscribeToken } from "@/lib/alerts/token";
import { resubscribe, setHomeAlertsFor, unsubscribe } from "@/lib/alerts/unsubscribe";
import { authorize, can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";

export type HomeAlertsResult = { ok: true; enabled: boolean } | { ok: false; error: string };

/** Account page: price/status emails for the signed-in user's saved homes. */
export async function setHomeAlerts(enabled: boolean): Promise<HomeAlertsResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Please sign in again." };
  authorize(can.manageOwn(actor, { userId: actor.userId }));
  const value = z.boolean().safeParse(enabled);
  if (!value.success) return { ok: false, error: "Invalid value." };
  await setHomeAlertsFor(actor.userId, value.data);
  revalidatePath("/account");
  return { ok: true, enabled: value.data };
}

const frequency = z.enum(["instant", "daily", "weekly"]);

function unsubscribePage(token: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ token, ...extra });
  return `/alerts/unsubscribe?${params}`;
}

/*
 * Unsubscribe-link actions. No session needed — the signed token is the
 * authorization, and it covers exactly one alert for one user. They run only
 * from the confirm page's buttons (POST), never on a GET, so link scanners
 * that prefetch email links can't unsubscribe anyone.
 */

export async function confirmUnsubscribe(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const target = verifyUnsubscribeToken(token);
  if (!target) redirect(unsubscribePage(token));
  const { previous } = await unsubscribe(target);
  revalidatePath("/saved");
  revalidatePath("/account");
  redirect(unsubscribePage(token, previous && previous !== "off" ? { was: previous } : undefined));
}

export async function confirmResubscribe(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const target = verifyUnsubscribeToken(token);
  if (!target) redirect(unsubscribePage(token));
  await resubscribe(target, frequency.catch("daily").parse(form.get("frequency")));
  revalidatePath("/saved");
  revalidatePath("/account");
  redirect(unsubscribePage(token, { resubscribed: "1" }));
}
