import { backNavSuite } from "../back-nav-suite";
import { test } from "./helpers";

/*
 * Getting back to where you were, on pixel7 and iphone13 (the cases are in
 * ../back-nav-suite.ts): Back and "Back to results" from the 10th card, the photo viewer,
 * filter history, sign-in from a heart, the dashboard's way back, and the listing's bar.
 */
backNavSuite(test, { phone: true });
