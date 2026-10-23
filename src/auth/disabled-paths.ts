/**
 * Account-management routes this pilot does not use.
 * `disabledPaths` matches the path after `/api/auth`, exactly.
 * `/reset-password/:token` is not an exact path, so the auth `before` hook
 * rejects that prefix. Sign-in, the GitHub callback, session reads, and
 * sign-out are not in this list.
 */
export const DISABLED_ACCOUNT_PATHS = [
  "/update-user",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/verify-password",
  "/send-verification-email",
  "/verify-email",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/update-session",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
] as const;
