/**
 * Agents whose public email is fixed by the firm, whatever the Georgia MLS
 * feed or their editable agents row says. Display only: the stored feed data
 * (listings.attribution_email) and the sync stay untouched, so a sync can't
 * undo it. Applied by src/lib/agents/display-email.ts.
 *
 * Andrea Anderegg (broker): owner decision of 2026-10-26. The feed sends her
 * listings varying GAMLS2_AttributionContactEmail values, including a typo
 * ("adamsreatly", ListingId 10823293).
 */
export type AgentEmailOverride = {
  /** The agents row id. */
  agentId: string;
  /** The Georgia MLS agent ID (matched case-insensitively). */
  mlsAgentId: string;
  email: string;
};

export const agentEmailOverrides: readonly AgentEmailOverride[] = [
  {
    agentId: "071b7b99-e3c2-47f8-9026-16ee79900bc5",
    mlsAgentId: "ANDEREGGAA",
    email: "contracts.adamsrealty@gmail.com",
  },
];
