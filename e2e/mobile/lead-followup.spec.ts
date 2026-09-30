import { leadFollowupSuite } from "../lead-followup-suite";
import { test } from "./helpers";

/*
 * Lead follow-up in the dashboard on pixel7 and iphone13 (the cases are in
 * ../lead-followup-suite.ts).
 */
leadFollowupSuite(test, { phone: true });
