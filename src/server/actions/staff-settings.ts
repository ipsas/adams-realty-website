"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";

export type EmailSetting = "leadCopies" | "leadDigest";

export type EmailSettingResult = { ok: true; enabled: boolean } | { ok: false; error: string };

const input = z.object({ setting: z.enum(["leadCopies", "leadDigest"]), enabled: z.boolean() });

/**
 * Dashboard → Email settings: "Copy me on every new lead" (admins only,
 * `users.lead_copies`) and the 7 a.m. morning summary (every staff member,
 * `users.lead_digest`). Both are on by default.
 */
export async function setEmailSetting(
  setting: EmailSetting,
  enabled: boolean,
): Promise<EmailSettingResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Your session ended. Sign in again, then retry." };
  if (!can.manageEmailSettings(actor))
    return { ok: false, error: "Your account doesn't get lead emails." };
  const parsed = input.safeParse({ setting, enabled });
  if (!parsed.success) return { ok: false, error: "Invalid value." };
  if (parsed.data.setting === "leadCopies" && !can.copyOnAllLeads(actor))
    return { ok: false, error: "Only the broker's account gets copies of every lead." };
  await db
    .update(users)
    .set({ [parsed.data.setting]: parsed.data.enabled })
    .where(eq(users.id, actor.userId));
  revalidatePath("/dashboard/settings");
  return { ok: true, enabled: parsed.data.enabled };
}
