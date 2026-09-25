/**
 * MapLibre GL v6 runs map parsing in a module Web Worker that it loads from a
 * URL. Bundlers don't emit that file, so we serve a versioned copy from
 * /public (see `setWorkerUrl` in src/components/search/map-setup.ts).
 * Runs on postinstall; the output is git-ignored.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(root, "public", "vendor", "maplibre", version);
mkdirSync(out, { recursive: true });
// The worker imports the shared chunk by relative path, so both are copied.
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(pkgDir, "dist", file), join(out, file));
}
console.log(`maplibre worker ${version} → public/vendor/maplibre/${version}/`);
