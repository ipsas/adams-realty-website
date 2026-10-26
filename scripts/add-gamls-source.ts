/**
 * Adds (or updates) the Georgia MLS source row (src/lib/mls/gamls.ts) for when
 * the Bridge token arrives. Manual use only:
 *
 *   npm run mls:add-gamls
 *
 * The row is active only when MLS_GAMLS_TOKEN (or client credentials) is set;
 * otherwise it is left inactive and the missing variable is printed. Only the
 * definition columns are written, never the sync cursor.
 */
import "dotenv/config";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { gamlsSource } from "@/lib/mls/gamls";
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
      },
    })
    .returning();
  console.info(saved);
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
