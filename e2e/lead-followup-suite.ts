import { type Page, expect, type test as baseTest } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";
import {
  expectControlsAtLeast16px,
  expectNoHorizontalOverflow,
  expectTapTargets,
  gotoHydrated,
  withDb,
} from "./mobile/helpers";

/*
 * Lead follow-up in the dashboard (site review #3, #9): the "Needs attention" box, the
 * "Follow up on" date, the first-contact time and reply times, email settings, and the
 * lead link the emails carry. e2e/lead-followup.spec.ts runs it on desktop and
 * e2e/mobile/lead-followup.spec.ts on pixel7 and iphone13. Not a spec file itself.
 *
 * Each test makes its own leads (names start with "E2E ") at chosen times, so nothing
 * depends on the seed's clock, and deletes them afterwards. The emails themselves are
 * covered by the database tests (src/lib/leads/*.db.test.ts) with the mailer swapped out.
 */

const DANIEL = "daniel@adamsrealty.example";
const ADMIN = "admin@adamsrealty.example";
const TZ = "America/New_York";

type LeadRow = {
  name: string;
  status?: string;
  type?: string;
  /** SQL for created_at, e.g. "now() - interval '10 days'". */
  createdAt?: string;
  tourAt?: string;
  followUpOn?: string;
};

/** Inserts leads for Daniel; returns their ids in order. */
async function danielLeads(rows: LeadRow[]): Promise<string[]> {
  return withDb(async (db) => {
    const ids: string[] = [];
    for (const r of rows) {
      const res = await db.query<{ id: string }>(
        `insert into inquiries (type, status, source, name, email, agent_id, created_at, tour_at, follow_up_on)
         values ($1, $2, 'contact', $3, $4,
           (select id from agents where email = $5),
           ${r.createdAt ?? "now()"}, ${r.tourAt ?? "null"}, ${r.followUpOn ?? "null"})
         returning id`,
        [
          r.type ?? "question",
          r.status ?? "new",
          r.name,
          `${r.name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
          DANIEL,
        ],
      );
      ids.push(res.rows[0].id);
    }
    return ids;
  });
}

const deleteLeads = (ids: string[]) =>
  withDb((db) => db.query("delete from inquiries where id = any($1::uuid[])", [ids]));

const leadRow = (id: string) =>
  withDb((db) =>
    db
      .query<{
        follow_up_on: string | null;
        first_contacted_at: Date | null;
        status: string;
      }>("select follow_up_on::text, first_contacted_at, status from inquiries where id = $1", [id])
      .then((r) => r.rows[0]),
  );

/** The market's calendar day, `plus` days from today, as Postgres counts it. */
const marketDay = (plus = 0) =>
  withDb((db) =>
    db
      .query<{ d: string }>(`select ((now() at time zone '${TZ}')::date + $1::int)::text as d`, [
        plus,
      ])
      .then((r) => r.rows[0].d),
  );

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function switchUser(page: Page, email: string, next: string) {
  await page.context().clearCookies();
  await signIn(page, email, next);
}

export function leadFollowupSuite(test: typeof baseTest, { phone }: { phone: boolean }) {
  test.describe("lead follow-up", () => {
    test("Needs attention: a lead waiting too long in red with how long, tours in 48 hours, follow-ups due", async ({
      page,
    }) => {
      const s = stamp();
      const ids = await danielLeads([
        { name: `E2E Waiting ${s}`, createdAt: "now() - interval '10 days'" },
        { name: `E2E Fresh ${s}` },
        {
          name: `E2E Tour ${s}`,
          type: "tour",
          status: "contacted",
          tourAt: "now() + interval '24 hours'",
        },
        {
          name: `E2E Follow ${s}`,
          status: "contacted",
          followUpOn: `(now() at time zone '${TZ}')::date`,
        },
        {
          name: `E2E Overdue ${s}`,
          status: "qualified",
          followUpOn: `(now() at time zone '${TZ}')::date - 2`,
        },
      ]);
      try {
        await signIn(page, DANIEL, "/dashboard");
        await gotoHydrated(page, "/dashboard", "[data-testid=needs-attention]");
        const box = page.getByTestId("needs-attention");

        const waiting = box.getByTestId("attention-waiting");
        const row = waiting.getByRole("link", { name: new RegExp(`E2E Waiting ${s}`) });
        await expect(row).toBeVisible();
        const pill = row.getByTestId("waiting-label");
        await expect(pill).toHaveText("Waiting 10 days");
        await expect(pill).toHaveClass(/text-clay-600/);
        // Arrived a moment ago: not waiting too long yet.
        await expect(box.getByText(`E2E Fresh ${s}`)).toHaveCount(0);

        await expect(
          box
            .getByTestId("attention-tours")
            .getByRole("link", { name: new RegExp(`E2E Tour ${s}`) }),
        ).toBeVisible();
        const followUps = box.getByTestId("attention-follow-ups");
        await expect(
          followUps.getByRole("link", { name: new RegExp(`E2E Follow ${s}.*Today`) }),
        ).toBeVisible();
        await expect(
          followUps.getByRole("link", { name: new RegExp(`E2E Overdue ${s}.*Was due`) }),
        ).toBeVisible();

        if (phone) {
          await expectNoHorizontalOverflow(page);
          await expectTapTargets(page, "[data-testid=needs-attention] a");
        }

        await row.click();
        await expect(page).toHaveURL(`/dashboard/leads/${ids[0]}`);
        await expect(page.getByTestId("lead-waiting")).toHaveText("Waiting 10 days");
        await expect(page.getByTestId("first-contact")).toHaveText("Not yet");

        // The leads list flags it too.
        await gotoHydrated(page, "/dashboard/leads?status=new", "main h1");
        const inList = page
          .locator(`main a[href='/dashboard/leads/${ids[0]}']:visible`)
          .first()
          .locator("xpath=ancestor-or-self::*[self::li or self::tr][1]");
        await expect(inList.getByTestId("waiting-label")).toHaveText("Waiting 10 days");
      } finally {
        await deleteLeads(ids);
      }
    });

    test("Follow up on: the quick buttons and the date field save; a due date joins Needs attention; Clear removes it", async ({
      page,
    }) => {
      const s = stamp();
      const [id] = await danielLeads([{ name: `E2E Later ${s}`, status: "contacted" }]);
      try {
        await signIn(page, DANIEL, "/dashboard");
        await gotoHydrated(page, `/dashboard/leads/${id}`, "[data-testid=follow-up]");
        const control = page.getByTestId("follow-up");
        const status = page.getByTestId("follow-up-status");
        await expect(status).toHaveText("No follow-up set.");
        if (phone) {
          await expectControlsAtLeast16px(page, "[data-testid=follow-up]");
          await expectTapTargets(page, "[data-testid=follow-up] button");
        }

        await control.getByRole("button", { name: "Tomorrow" }).click();
        const tomorrow = await marketDay(1);
        await expect.poll(async () => (await leadRow(id)).follow_up_on).toBe(tomorrow);
        await expect(status).toHaveText(/^Set for /);
        await expect(page.locator("#follow-up-on")).toHaveValue(tomorrow);

        await control.getByRole("button", { name: "Next week" }).click();
        await expect.poll(async () => (await leadRow(id)).follow_up_on).toBe(await marketDay(7));

        const today = await marketDay(0);
        await page.locator("#follow-up-on").fill(today);
        await expect.poll(async () => (await leadRow(id)).follow_up_on).toBe(today);
        await expect(status).toHaveText("Due today: it's under Needs attention.");

        await gotoHydrated(page, "/dashboard", "[data-testid=needs-attention]");
        await expect(
          page
            .getByTestId("attention-follow-ups")
            .getByRole("link", { name: new RegExp(`E2E Later ${s}`) }),
        ).toBeVisible();

        await gotoHydrated(page, `/dashboard/leads/${id}`, "[data-testid=follow-up]");
        await control.getByRole("button", { name: "Clear" }).click();
        await expect.poll(async () => (await leadRow(id)).follow_up_on).toBeNull();
        await expect(status).toHaveText("No follow-up set.");
      } finally {
        await deleteLeads([id]);
      }
    });

    test("marking a lead contacted records the first contact, and the broker sees the reply time", async ({
      page,
    }) => {
      const s = stamp();
      const [id] = await danielLeads([
        { name: `E2E Reply ${s}`, createdAt: "now() - interval '5 minutes'" },
      ]);
      try {
        await signIn(page, DANIEL, "/dashboard");
        await gotoHydrated(page, `/dashboard/leads/${id}`, "#lead-status");
        await page.locator("#lead-status").selectOption("contacted");
        await expect.poll(async () => (await leadRow(id)).first_contacted_at).not.toBeNull();
        expect((await leadRow(id)).status).toBe("contacted");
        await page.reload();
        await expect(page.getByTestId("first-contact")).toContainText(
          "of office time after it arrived",
        );

        // Daniel has no other recorded replies in the seed: his row is this lead.
        await switchUser(page, ADMIN, "/dashboard");
        await gotoHydrated(page, "/dashboard", "[data-testid=reply-times]");
        const row = page.getByTestId("reply-row").filter({ hasText: "Daniel Reyes" });
        await expect(row).toBeVisible();
        await expect(row.locator("td").nth(1)).not.toHaveText(/—/);
        if (phone) await expectNoHorizontalOverflow(page);
      } finally {
        await deleteLeads([id]);
      }
    });

    test("Email settings: the broker switches lead copies off and on; an agent has only the summary", async ({
      page,
    }) => {
      const copies = () =>
        withDb((db) =>
          db
            .query<{ lead_copies: boolean }>("select lead_copies from users where email = $1", [
              ADMIN,
            ])
            .then((r) => r.rows[0].lead_copies),
        );
      try {
        await signIn(page, ADMIN, "/dashboard");
        await gotoHydrated(page, "/dashboard/settings", "[data-testid=setting-leadCopies]");
        const copySwitch = page.getByRole("switch", { name: "Copy me on every new lead" });
        await expect(copySwitch).toHaveAttribute("aria-checked", "true");
        await expect(page.getByRole("switch", { name: /Morning summary/ })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        if (phone) {
          await expectNoHorizontalOverflow(page);
          await expectTapTargets(page, "main [role=switch]");
        }
        await copySwitch.click();
        await expect(copySwitch).toHaveAttribute("aria-checked", "false");
        await expect.poll(copies).toBe(false);
        await page.reload();
        await expect(copySwitch).toHaveAttribute("aria-checked", "false");
        await copySwitch.click();
        await expect.poll(copies).toBe(true);

        await switchUser(page, DANIEL, "/dashboard");
        await gotoHydrated(page, "/dashboard/settings", "[data-testid=setting-leadDigest]");
        await expect(page.getByRole("switch")).toHaveCount(1);
        await expect(page.getByRole("switch", { name: /Morning summary/ })).toBeVisible();
      } finally {
        await withDb((db) =>
          db.query("update users set lead_copies = true, lead_digest = true where email = $1", [
            ADMIN,
          ]),
        );
      }
    });

    test("an email's button opens the lead itself, through sign-in when signed out", async ({
      page,
    }) => {
      const s = stamp();
      const [id] = await danielLeads([{ name: `E2E Link ${s}` }]);
      try {
        await page.goto(`/dashboard/leads/${id}`);
        await expect(page).toHaveURL(/\/sign-in\?next=/);
        await page.fill("#email", DANIEL);
        await page.fill("#password", PASSWORD);
        await page.click("button[type=submit]");
        await expect(page).toHaveURL(`/dashboard/leads/${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E Link ${s}`);
      } finally {
        await deleteLeads([id]);
      }
    });
  });
}
