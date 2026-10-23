export type GitHubSignInResult = {
  error?: unknown;
};

/**
 * Better Auth returns `{ error }` for a normal HTTP failure and rejects the
 * promise for a thrown or network failure. Either outcome is a failure.
 * A result without `error` is the start of the provider redirect.
 * The raw error value is never returned.
 */
export async function completeGitHubSignIn(
  signIn: () => Promise<GitHubSignInResult | null | undefined>,
): Promise<"redirecting" | "failed"> {
  try {
    const result = await signIn();
    if (result?.error) {
      return "failed";
    }
    return "redirecting";
  } catch {
    return "failed";
  }
}
