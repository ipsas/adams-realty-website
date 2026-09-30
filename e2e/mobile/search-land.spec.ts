import { searchLandSuite } from "../search-land-suite";
import { test } from "./helpers";

/*
 * Searches that show the right homes, and land treated as land (site review #5, #8), on
 * pixel7 and iphone13 (the cases are in ../search-land-suite.ts): town and lake searches,
 * a moved map and its way back, the no-results helpers, commercial and the type heading,
 * land cards, sorts and pages, and area price per acre.
 */
searchLandSuite(test, { phone: true });
