import { Suspense } from "react";
import { signInErrorMessage } from "../../auth/messages";
import { SignInButton } from "./sign-in-button";

async function SignInError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.error) ? params.error[0] : params.error;
  const message = signInErrorMessage(raw);
  if (!message) {
    return null;
  }
  return <p role="alert">{message}</p>;
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] | undefined }>;
}) {
  return (
    <main>
      <h1>Sign in</h1>
      <p>DevFlow is a private pilot. Continue with GitHub if your account is approved.</p>
      <Suspense fallback={null}>
        <SignInError searchParams={searchParams} />
      </Suspense>
      <SignInButton />
    </main>
  );
}
