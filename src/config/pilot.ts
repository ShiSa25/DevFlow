import { parsePilotGithubUserIds, type PilotAllowlist } from "./pilot-allowlist";

/**
 * Read once, when this module is first loaded. `next start` and production
 * keep the result until the process is replaced. Request handlers do not
 * re-read PILOT_GITHUB_USER_IDS. Bracket access keeps Next from inlining a
 * build-time value into the server bundle.
 */
export const pilotAllowlist: PilotAllowlist = parsePilotGithubUserIds(
  process.env["PILOT_GITHUB_USER_IDS"],
);

if (pilotAllowlist.status === "empty") {
  console.error("Pilot allowlist is empty. Nobody is approved.");
} else if (pilotAllowlist.status === "malformed") {
  console.error("Pilot allowlist is malformed. Nobody is approved.");
}

export function isPilotGithubUser(accountId: string): boolean {
  return pilotAllowlist.status === "ready" && pilotAllowlist.ids.has(accountId);
}
