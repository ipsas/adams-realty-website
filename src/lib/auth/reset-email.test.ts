import { afterEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "@/test/console";
import { sendPasswordReset } from "./reset-email";

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return { ...mod, env: { ...mod.env, RESEND_API_KEY: undefined } };
});

afterEach(() => vi.restoreAllMocks());

const TOKEN = "tok_9f8e7d6c5b4a";
const url = `https://adams.example/reset-password/${TOKEN}?callbackURL=%2Faccount`;
const user = { name: "Jordan Buyer", email: "jordan.buyer@example.com" };

describe("password reset email", () => {
  it("with no Resend key: resolves as usual and never logs the link, token or address", async () => {
    const { output } = captureConsole();
    await expect(sendPasswordReset({ user, url })).resolves.toBeUndefined();
    const all = output().join("\n");
    expect(all).toContain(
      "[email] kind=password-reset to_domain=example.com status=not_configured",
    );
    for (const secret of [TOKEN, "reset-password", "callbackURL", "jordan.buyer", "Jordan"])
      expect(all).not.toContain(secret);
  });

  it("never throws, even when the mailer does", async () => {
    captureConsole();
    const send = vi.fn(async () => {
      throw new Error(`failed for ${url}`);
    });
    await expect(sendPasswordReset({ user, url }, send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "password-reset" }));
  });

  it("logs exactly one failure line, with the HTTP code, when the send finally fails", async () => {
    const { output } = captureConsole();
    const send = vi.fn(async () => ({
      ok: false as const,
      reason: "send_failed" as const,
      status: 503,
    }));
    await expect(sendPasswordReset({ user, url }, send)).resolves.toBeUndefined();
    expect(output()).toEqual(["[email] kind=reset status=failed http=503"]);
  });

  it("logs http=none when no answer came (or the mailer threw)", async () => {
    const { output } = captureConsole();
    await sendPasswordReset({ user, url }, async () => ({ ok: false, reason: "send_failed" }));
    await sendPasswordReset({ user, url }, async () => {
      throw new Error(`failed for ${url}`);
    });
    expect(output()).toEqual([
      "[email] kind=reset status=failed http=none",
      "[email] kind=reset status=failed http=none",
    ]);
  });

  it("logs no failure line when it went", async () => {
    const { output } = captureConsole();
    await sendPasswordReset({ user, url }, async () => ({ ok: true }));
    expect(output()).toEqual([]);
  });
});
