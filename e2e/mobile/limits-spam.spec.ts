import { limitsSpamSuite } from "../limits-spam-suite";
import { test } from "./helpers";

/*
 * The listing rate limiter's 429 page and the form spam checks on pixel7 and iphone13
 * (the cases are in ../limits-spam-suite.ts).
 */
limitsSpamSuite(test, { phone: true });
