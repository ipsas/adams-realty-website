/** The staff dashboard's warning while RESEND_API_KEY is missing; nothing once email is configured. */
export function EmailNotConfiguredNotice({ configured }: { configured: boolean }) {
  if (configured) return null;
  return (
    <p role="alert" className="mb-6 rounded-2xl bg-clay-50 px-4 py-3 text-sm text-clay-600">
      <strong className="font-semibold">Email is not configured:</strong> RESEND_API_KEY is missing,
      so no alerts, digests, lead notices or password resets are being sent.
    </p>
  );
}
