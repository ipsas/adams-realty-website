import { site } from "@/config/site";

type TourFields = {
  type: string;
  tourDate?: string;
  tourTime?: string;
  tourType?: "in_person" | "video";
};

/**
 * A tour request for a home that offers no tours (outside the firm's area)
 * becomes a question: the form never offers one there, and a crafted request
 * mustn't book our agents for a showing we can't give.
 */
export function withoutTour<T extends TourFields>(d: T, toursOffered: boolean): T {
  if (toursOffered || d.type !== "tour") return d;
  return { ...d, type: "question", tourDate: undefined, tourTime: undefined, tourType: undefined };
}

/**
 * The thank-you line. Outside the firm's area it promises no tour and claims
 * no local knowledge: the office answers.
 */
export function inquiryReply(
  d: { type: string; name: string },
  agentName: string | null,
  outOfArea: boolean,
): string {
  const firstName = agentName?.split(" ")[0];
  const theirs = d.name.split(" ")[0];
  if (outOfArea && !agentName) {
    return `Thanks, ${theirs}! Your question went to the ${site.name} office, and we'll get back to you soon.`;
  }
  return d.type === "tour"
    ? `Request sent! ${firstName ?? "An Adams agent"} will confirm your tour shortly.`
    : `Thanks, ${theirs}! ${firstName ?? "An Adams agent"} will be in touch soon.`;
}
