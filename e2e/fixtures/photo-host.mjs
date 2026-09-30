/**
 * A fake MLS photo host for the photo tests (site review #10). It stands in for a
 * Georgia MLS media CDN that serves full-size originals and can't resize: every
 * `GET /mls/<anything>.jpg` returns the same large JPEG (3000×2000, about 2.5 MB,
 * made with sharp at startup, so nothing binary is committed). It listens on
 * 127.0.0.1, a different host from the site's `localhost`, so a request the browser
 * sends straight to it is easy to spot.
 *
 * Started by playwright.config.ts (webServer) and by scripts/perf/photo-weight.ts.
 * `next.config.ts` lets the image optimizer fetch from it outside production only
 * (or when E2E_PHOTO_HOST is set, for a local `next start`).
 *
 *   node e2e/fixtures/photo-host.mjs            # port 4010
 *   PHOTO_HOST_PORT=4011 node e2e/fixtures/photo-host.mjs
 */
import { createServer } from "node:http";
import sharp from "sharp";

export const WIDTH = 3000;
export const HEIGHT = 2000;
const port = Number(process.env.PHOTO_HOST_PORT ?? 4010);

/** A photo-like image: smooth gradients plus grain, which keeps the JPEG realistically big. */
async function makeJpeg() {
  const channels = 3;
  const buf = Buffer.alloc(WIDTH * HEIGHT * channels);
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const clamp = (v) => Math.max(0, Math.min(255, v));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * channels;
      const grain = (rnd() - 0.5) * 60;
      buf[i] = clamp(90 + (120 * x) / WIDTH + grain);
      buf[i + 1] = clamp(140 - (60 * y) / HEIGHT + 40 * Math.sin(x / 37) + grain);
      buf[i + 2] = clamp(60 + (150 * y) / HEIGHT + 30 * Math.cos(y / 23) + grain);
    }
  }
  return sharp(buf, { raw: { width: WIDTH, height: HEIGHT, channels } })
    .jpeg({ quality: 88 })
    .toBuffer();
}

const jpeg = await makeJpeg();

const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (req.method === "GET" && path === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("fake MLS photo host\n");
  } else if ((req.method === "GET" || req.method === "HEAD") && /^\/mls\/[\w.-]+\.jpg$/.test(path)) {
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": jpeg.length,
      "cache-control": "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : jpeg);
  } else {
    res.writeHead(404).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake MLS photo host on http://127.0.0.1:${port} (${jpeg.length} bytes per photo)`);
});
