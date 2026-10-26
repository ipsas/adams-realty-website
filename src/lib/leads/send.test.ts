import { describe, expect, it } from "vitest";
import { catchSendFailure, SEND_FAILED } from "./send";

describe("catchSendFailure", () => {
  it("passes the action's result through", async () => {
    const result = { ok: false, errors: { name: "Please enter your name" } };
    const send = catchSendFailure(async () => result);
    expect(await send({ ok: false }, new FormData())).toBe(result);
  });

  it("turns a thrown error (failed request, 500) into a form message", async () => {
    const send = catchSendFailure(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await send({ ok: false }, new FormData())).toEqual({ ok: false, message: SEND_FAILED });
  });
});
