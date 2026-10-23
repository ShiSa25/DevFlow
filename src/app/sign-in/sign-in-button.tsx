"use client";

import { useRef, useState } from "react";
import { authClient } from "../../auth/client";
import { SIGN_IN_FAILED_MESSAGE } from "../../auth/messages";
import { completeGitHubSignIn, type GitHubSignInResult } from "../../auth/sign-in-attempt";

const SIGN_IN_ERROR_ID = "github-sign-in-error";

type SignIn = () => Promise<GitHubSignInResult | null | undefined>;

function defaultSignIn(): Promise<GitHubSignInResult | null | undefined> {
  return authClient.signIn.social({
    provider: "github",
    callbackURL: "/dashboard",
    errorCallbackURL: "/sign-in",
  });
}

export function SignInButton({ signIn = defaultSignIn }: { signIn?: SignIn }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingRef = useRef(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-describedby={failed ? SIGN_IN_ERROR_ID : undefined}
        onClick={() => {
          if (pendingRef.current) {
            return;
          }
          pendingRef.current = true;
          setPending(true);
          setFailed(false);
          void completeGitHubSignIn(signIn).then((outcome) => {
            if (outcome === "failed") {
              pendingRef.current = false;
              setPending(false);
              setFailed(true);
            }
          });
        }}
      >
        Continue with GitHub
      </button>
      {failed ? (
        <p id={SIGN_IN_ERROR_ID} role="alert">
          {SIGN_IN_FAILED_MESSAGE}
        </p>
      ) : null}
    </>
  );
}
