/**
 * Adds (or updates) the Georgia MLS source row (src/lib/mls/gamls.ts) for when
 * the Bridge token arrives. Manual use only:
 *
 *   npm run mls:add-gamls
 *
 * The row is active only when MLS_GAMLS_TOKEN (or client credentials) is set;
 * otherwise it is left inactive and the missing variable is printed. Only the
 * definition columns are written; the sync cursor is kept, unless the saved
 * row pointed at another feed (dataset or office filter), whose cursor would
 * make the incremental sync skip this feed's older listings: then it is reset.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { feedChanged, gamlsDataset, gamlsSource } from "@/lib/mls/gamls";
import { missingCredentials } from "@/lib/mls/reso/provider";

async function main() {
  const row = gamlsSource();
  const missing = [
    missingCredentials(row.config, process.env),
    row.config.baseUrl ? null : "MLS_GAMLS_DATASET is not set",
  ]
    .filter(Boolean)
    .join("; ");
  const values = { ...row, isActive: !missing };
  const [prev] = await db
    .select({ config: dataSources.config })
    .from(dataSources)
    .where(eq(dataSources.slug, values.slug));
  const resetCursor = feedChanged(prev?.config, values.config);
  const [saved] = await db
    .insert(dataSources)
    .values(values)
    .onConflictDoUpdate({
      target: dataSources.slug,
      set: {
        name: values.name,
        kind: values.kind,
        config: values.config,
        disclaimer: values.disclaimer,
        isActive: values.isActive,
        ...(resetCursor ? { syncCursor: null, syncCursorKey: null } : {}),
      },
    })
    .returning({ slug: dataSources.slug, isActive: dataSources.isActive });
  const dataset = gamlsDataset() ?? "(unset)";
  console.info({ slug: saved.slug, isActive: saved.isActive, dataset });
  console.info(
    resetCursor
      ? `sync cursor reset: feed changed (dataset ${dataset})`
      : "sync cursor kept: feed unchanged or new row",
  );
  console.info(
    missing ? `left inactive: ${missing}; set it and run this again` : "active: credentials found",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
