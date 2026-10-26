import { type AgentEmailOverride, agentEmailOverrides } from "@/config/agent-email-overrides";

/**
 * The email shown for (and used to reach) an agent or their listings, after the
 * firm's fixed overrides (src/config/agent-email-overrides.ts). Display only:
 * stored rows are never rewritten.
 */

function findOverride(
  id: string | null | undefined,
  mlsAgentId: string | null | undefined,
  overrides: readonly AgentEmailOverride[],
): AgentEmailOverride | undefined {
  const mls = mlsAgentId?.trim().toUpperCase();
  return overrides.find(
    (o) => (!!id && o.agentId === id) || (!!mls && o.mlsAgentId.toUpperCase() === mls),
  );
}

/** An agent's email: the override when the agent matches by row id or MLS agent ID. */
export function displayAgentEmail<E extends string | null>(
  agent: { id?: string | null; mlsAgentId?: string | null; email: E },
  overrides: readonly AgentEmailOverride[] = agentEmailOverrides,
): E | string {
  return findOverride(agent.id, agent.mlsAgentId, overrides)?.email ?? agent.email;
}

/**
 * A listing's attribution contact email: on a listing by an overridden agent
 * always the override (even when the feed sent none), else the feed's own.
 */
export function displayAttributionEmail(
  listing: {
    attributionEmail: string | null;
    listAgentId?: string | null;
    listAgentMlsId?: string | null;
  },
  overrides: readonly AgentEmailOverride[] = agentEmailOverrides,
): string | null {
  return (
    findOverride(listing.listAgentId, listing.listAgentMlsId, overrides)?.email ??
    listing.attributionEmail
  );
}
