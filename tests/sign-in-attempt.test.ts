import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIGN_IN_FAILED_MESSAGE } from "../src/auth/messages";
import { completeGitHubSignIn } from "../src/auth/sign-in-attempt";

const RAW_FAILURE = "postgres://user:secret@db.example/devflow internal stack";

describe("GitHub sign-in attempt", () => {
  it("treats a resolved HTTP error as a failure and drops the server body", async () => {
    const outcome = await completeGitHubSignIn(async () => ({
      data: null,
      error: { message: RAW_FAILURE, status: 502, code: "INTERNAL" },
    }));
    assert.equal(outcome, "failed");
    assert.equal(SIGN_IN_FAILED_MESSAGE.includes("secret"), false);
    assert.equal(SIGN_IN_FAILED_MESSAGE.includes("db.example"), false);
    assert.equal(SIGN_IN_FAILED_MESSAGE.includes("INTERNAL"), false);
  });

  it("treats a thrown network failure as a failure", async () => {
    const outcome = await completeGitHubSignIn(async () => {
      throw new Error(`network down ${RAW_FAILURE}`);
    });
    assert.equal(outcome, "failed");
  });

  it("keeps a successful provider response in the redirecting state", async () => {
    const outcome = await completeGitHubSignIn(async () => ({
      data: { url: "https://github.com/login/oauth/authorize", redirect: true },
      error: null,
    }));
    assert.equal(outcome, "redirecting");
  });
});
