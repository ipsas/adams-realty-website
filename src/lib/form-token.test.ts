import { describe, expect, it } from "vitest";
import { FORM_TOKEN_MAX_AGE_MS, formTokenElapsed, issueFormToken } from "./form-token";

const SECRET = "test-secret-test-secret-test-secret-42";
const T0 = 1_780_000_000_000;

describe("the form timer token", () => {
  it("measures the time since the form opened on the server's own clock", () => {
    const token = issueFormToken(SECRET, T0);
    expect(formTokenElapsed(token, SECRET, T0 + 8_400)).toBe(8_400);
    expect(formTokenElapsed(token, SECRET, T0)).toBe(0);
    // Two tokens issued at the same moment differ (a nonce), and both check out.
    const again = issueFormToken(SECRET, T0);
    expect(again).not.toBe(token);
    expect(formTokenElapsed(again, SECRET, T0 + 1)).toBe(1);
  });

  it("refuses anything a client makes up: no token, a number, another key, an edited time", () => {
    for (const bad of [undefined, null, "", "99999", "v1.99999", "v1.1.2.3"]) {
      expect(formTokenElapsed(bad, SECRET, T0), String(bad)).toBeNull();
    }
    expect(
      formTokenElapsed(issueFormToken("another-secret-another-secret-xx", T0), SECRET, T0 + 9_000),
    ).toBeNull();
    const [v, , nonce, mac] = issueFormToken(SECRET, T0).split(".");
    const backdated = [v, String(T0 - 60_000), nonce, mac].join(".");
    expect(formTokenElapsed(backdated, SECRET, T0 + 1_000)).toBeNull();
  });

  it("expires after a week, and refuses a token from the future beyond clock drift", () => {
    const token = issueFormToken(SECRET, T0);
    expect(formTokenElapsed(token, SECRET, T0 + FORM_TOKEN_MAX_AGE_MS)).toBe(FORM_TOKEN_MAX_AGE_MS);
    expect(formTokenElapsed(token, SECRET, T0 + FORM_TOKEN_MAX_AGE_MS + 1)).toBeNull();
    // Another server instance a moment behind: counted as just opened.
    expect(formTokenElapsed(token, SECRET, T0 - 2_000)).toBe(0);
    expect(formTokenElapsed(token, SECRET, T0 - 60_000)).toBeNull();
  });
});
