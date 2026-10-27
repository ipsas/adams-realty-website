import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailNotConfiguredNotice } from "./email-notice";

const render = (configured: boolean) =>
  renderToStaticMarkup(createElement(EmailNotConfiguredNotice, { configured }));

describe("EmailNotConfiguredNotice", () => {
  it("warns the staff while RESEND_API_KEY is missing", () => {
    const html = render(false);
    expect(html).toContain('role="alert"');
    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "Email is not configured: RESEND_API_KEY is missing, so no alerts, digests, lead notices or password resets are being sent.",
    );
  });

  it("renders nothing once email is configured", () => {
    expect(render(true)).toBe("");
  });
});
