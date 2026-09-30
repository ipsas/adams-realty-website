import { test } from "@playwright/test";
import { photosSuite } from "./photos-suite";

/*
 * Photos on a weak signal (site review #10), on desktop. The cases live in photos-suite.ts;
 * e2e/mobile/photos.spec.ts runs them on pixel7 and iphone13.
 */
photosSuite(test, { phone: false });
