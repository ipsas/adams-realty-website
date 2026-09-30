import { photosSuite } from "../photos-suite";
import { test } from "./helpers";

/*
 * Photos on a weak signal (site review #10), on pixel7 and iphone13 (the cases are in
 * ../photos-suite.ts): one resized photo per card within a byte budget, the next on a
 * swipe, nothing wider than 800 px, MLS photos never sent full size, and a home's gallery,
 * similar homes and map loading only when needed.
 */
photosSuite(test, { phone: true });
