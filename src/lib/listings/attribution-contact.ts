import { site } from "@/config/site";
import { displayAttributionEmail } from "@/lib/agents/display-email";
import { formatDisplayPhone } from "@/lib/format";

/**
 * A listing's attribution contact as displayed. The GAMLS IDX agreement (section 20)
 * requires showing the listing's Attribution Contact Phone/Email when present. For the
 * firm's own listings with an empty field, the firm chose its office contact
 * (site.phone / site.email) as the fallback, per field; never agent-specific invented
 * values. Other firms' listings are never filled in (R&R 12d). Idempotent: already
 * displayed values come back unchanged.
 */
export function listingContact(l: {
  attributionPhone: string | null;
  attributionEmail: string | null;
  isCompanyListing?: boolean | null;
  listAgentId?: string | null;
  listAgentMlsId?: string | null;
}): { phone: string | null; email: string | null } {
  return {
    phone:
      formatDisplayPhone(l.attributionPhone) ??
      (l.isCompanyListing ? formatDisplayPhone(site.phone) : null),
    email:
      displayAttributionEmail(l) ?? (l.isCompanyListing ? site.email.trim().toLowerCase() : null),
  };
}
