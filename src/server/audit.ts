import type { Executor } from "@/db";
import { auditLogs } from "@/db/schema";

/** Append-only record of sensitive staff actions (role changes, listing edits, lead routing). */
export async function audit(
  db: Executor,
  entry: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    changes?: Record<string, unknown>;
  },
) {
  await db.insert(auditLogs).values(entry);
}
