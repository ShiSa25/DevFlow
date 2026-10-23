const CANONICAL_GITHUB_ID = /^[1-9][0-9]*$/;

/**
 * GitHub's user id is a JSON integer. Store and compare the decimal digits.
 * Reject values that are not a finite safe integer so a rounded id cannot
 * become an account.
 */
export function canonicalGithubUserId(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      return undefined;
    }
    return String(value);
  }

  if (typeof value === "string" && CANONICAL_GITHUB_ID.test(value)) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || String(numeric) !== value) {
      return undefined;
    }
    return value;
  }

  return undefined;
}

export function githubUserIdFromProfile(profile: unknown): string | undefined {
  if (typeof profile !== "object" || profile === null || !("id" in profile)) {
    return undefined;
  }
  return canonicalGithubUserId(profile.id);
}

export function syntheticGithubEmail(githubUserId: string): string {
  return `${githubUserId}@users.noreply.devflow.invalid`;
}
