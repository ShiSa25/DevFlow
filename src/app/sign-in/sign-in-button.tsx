"use client";

import { useState } from "react";
import { authClient } from "../../auth/client";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void authClient
          .signIn.social({
            provider: "github",
            callbackURL: "/dashboard",
            errorCallbackURL: "/sign-in",
          })
          .catch(() => {
            setPending(false);
          });
      }}
    >
      Continue with GitHub
    </button>
  );
}
