@AGENTS.md

# Adams Realty — project notes

Website for Adams Realty, Inc., 69 Mill Street, Royston, GA: a brokerage serving Northeast Georgia
(homes, land, farms, lake and commercial property). See README.md for setup and ARCHITECTURE.md for design.

- Stack: Next.js 16 App Router (read `node_modules/next/dist/docs/` — APIs differ from older versions:
  async `params`/`searchParams`, `proxy.ts` instead of middleware, `PageProps<"/route">` helpers),
  Tailwind CSS 4 (tokens in `src/app/globals.css`), Drizzle ORM + Postgres, Better Auth, MapLibre GL 6.
- Checks before committing: `npm run lint && npm run typecheck && npm test`; UI flows: `npm run test:e2e`
  (needs `npm run db:reset` and a dev server; set `PLAYWRIGHT_CHROMIUM_PATH` if browsers aren't installed).
- Authorization lives in `src/lib/auth/permissions.ts` (pure, unit-tested). Every server action and
  staff page must call it; hiding UI is not enforcement.
- All listings (MLS sync, seed, dashboard) are written through `upsertListing` in
  `src/lib/listings/persist.ts`. MLS-sourced listings are read-only in the app.
- Search is URL-driven: `src/lib/search/params.ts` parses/serializes criteria; `query.ts` builds SQL.
- Market/brand settings live in `src/config/site.ts` (Northeast Georgia, America/New_York; Georgia MLS
  office `ADAM01`). Placeholders there (email, GREC license, hours) are unknown — never invent them.
- Andrea Anderegg (broker) is a real person: her profile holds only facts from her public profiles.
  Never invent her bio, experience, stats or photo. Other seeded agents and all listings are fictional.
- Drizzle renders column refs unqualified inside `select({...})` fields — use explicit
  `"listings"."id"` in correlated subqueries there.
- Responsive grids need an explicit `grid-cols-1` base so long nowrap text can't widen the page on mobile.
