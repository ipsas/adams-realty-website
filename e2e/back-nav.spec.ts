import { test } from "@playwright/test";
import { backNavSuite } from "./back-nav-suite";

/*
 * Getting back to where you were, on desktop. The cases live in back-nav-suite.ts;
 * e2e/mobile/back-nav.spec.ts runs them on pixel7 and iphone13.
 */
backNavSuite(test, { phone: false });
