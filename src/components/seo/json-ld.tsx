import { env } from "@/lib/env";
import { type AgentProfile, agentJsonLd, organizationJsonLd, serializeJsonLd } from "@/lib/json-ld";

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

/** The firm as a schema.org RealEstateAgent (home, About and Contact pages). */
export function OrganizationJsonLd() {
  return <JsonLd data={organizationJsonLd(env.NEXT_PUBLIC_SITE_URL)} />;
}

/** An agent as a schema.org Person working for the firm (agent profile page). */
export function AgentJsonLd({ agent }: { agent: AgentProfile }) {
  return <JsonLd data={agentJsonLd(agent, env.NEXT_PUBLIC_SITE_URL)} />;
}
