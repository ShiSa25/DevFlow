export const PILOT_NOT_APPROVED_CODE = "pilot_not_approved";

export const PILOT_NOT_APPROVED_MESSAGE = "This GitHub account is not approved.";

export const SIGN_IN_CANCELLED_MESSAGE = "GitHub sign-in was cancelled.";

export const SIGN_IN_FAILED_MESSAGE = "GitHub sign-in did not complete. Try again.";

/**
 * Map a known OAuth error code to fixed copy. The raw query value is never
 * returned, so provider text cannot be inserted into the page.
 */
export function signInErrorMessage(error: string | undefined): string | undefined {
  if (!error) {
    return undefined;
  }
  if (error === PILOT_NOT_APPROVED_CODE) {
    return PILOT_NOT_APPROVED_MESSAGE;
  }
  if (error === "access_denied") {
    return SIGN_IN_CANCELLED_MESSAGE;
  }
  return SIGN_IN_FAILED_MESSAGE;
}
