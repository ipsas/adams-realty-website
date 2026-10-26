import type { InquiryState } from "./submit";

/** Shown in the form when a lead couldn't reach the server (network error, 500). */
export const SEND_FAILED = "Couldn't send your message. Please try again.";

/**
 * Wraps the lead form's server action for `useActionState`: a thrown error
 * (the request failed, or the action threw) becomes a form-level message
 * instead of reaching the error boundary, which would drop what was typed.
 */
export function catchSendFailure(
  action: (prev: InquiryState, form: FormData) => Promise<InquiryState>,
): (prev: InquiryState, form: FormData) => Promise<InquiryState> {
  return async (prev, form) => {
    try {
      return await action(prev, form);
    } catch {
      return { ok: false, message: SEND_FAILED };
    }
  };
}
