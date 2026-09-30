import { test } from "@playwright/test";
import { leadFollowupSuite } from "./lead-followup-suite";

/*
 * Lead follow-up in the dashboard on desktop: Needs attention, the follow-up date, first
 * contact and reply times, email settings and the emails' lead link. The cases live in
 * lead-followup-suite.ts; e2e/mobile/lead-followup.spec.ts runs them on pixel7 and iphone13.
 */
leadFollowupSuite(test, { phone: false });
