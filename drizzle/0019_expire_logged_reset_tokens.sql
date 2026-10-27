-- Password-reset links were written to production logs (sendEmail used to log full bodies),
-- so delete every reset token issued before this deploy. better-auth stores them in plain
-- text as 'reset-password:<token>'; other verification rows are untouched. Safe to re-run.
DELETE FROM "verifications" WHERE "identifier" LIKE 'reset-password:%' AND "created_at" < now();
