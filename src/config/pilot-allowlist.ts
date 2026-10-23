const CANONICAL_GITHUB_ID = /^[1-9][0-9]*$/;

export type PilotAllowlist =
  | { status: "empty" }
  | { status: "malformed" }
  | { status: "ready"; ids: ReadonlySet<string> };

/**
 * Parse PILOT_GITHUB_USER_IDS. Comparison is string-only.
 * Empty and malformed both deny access. A malformed value does not
 * keep the well-formed tokens.
 */
export function parsePilotGithubUserIds(raw: string | undefined): PilotAllowlist {
  if (raw === undefined || raw.trim() === "") {
    return { status: "empty" };
  }

  const tokens = raw.trim().split(",").map((token) => token.trim());
  const ids = new Set<string>();
  for (const token of tokens) {
    if (!CANONICAL_GITHUB_ID.test(token)) {
      return { status: "malformed" };
    }
    ids.add(token);
  }

  if (ids.size === 0) {
    return { status: "empty" };
  }

  return { status: "ready", ids };
}
