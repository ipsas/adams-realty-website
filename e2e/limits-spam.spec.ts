import { test } from "@playwright/test";
import { limitsSpamSuite } from "./limits-spam-suite";

/*
 * The listing rate limiter (its 429 page, preview robots, crawlers, signed-in buyers,
 * staff) and spam protection on the public forms, on desktop. The cases live in
 * limits-spam-suite.ts; e2e/mobile/limits-spam.spec.ts runs them on pixel7 and iphone13.
 */
limitsSpamSuite(test, { phone: false });
