import { test } from "@playwright/test";
import { searchLandSuite } from "./search-land-suite";

/*
 * Searches that show the right homes, and land treated as land (site review #5, #8), on
 * desktop. The cases live in search-land-suite.ts; e2e/mobile/search-land.spec.ts runs
 * them on pixel7 and iphone13.
 */
searchLandSuite(test, { phone: false });
