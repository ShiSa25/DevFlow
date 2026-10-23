import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PILOT_NOT_APPROVED_MESSAGE,
  SIGN_IN_CANCELLED_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
  signInErrorMessage,
} from "../src/auth/messages";

describe("sign-in error copy", () => {
  it("uses fixed copy for known codes and does not echo query text", () => {
    assert.equal(signInErrorMessage(undefined), undefined);
    assert.equal(signInErrorMessage("pilot_not_approved"), PILOT_NOT_APPROVED_MESSAGE);
    assert.equal(signInErrorMessage("access_denied"), SIGN_IN_CANCELLED_MESSAGE);
    assert.equal(signInErrorMessage("email_not_found"), SIGN_IN_FAILED_MESSAGE);
    assert.equal(
      signInErrorMessage("<script>alert(1)</script>"),
      SIGN_IN_FAILED_MESSAGE,
    );
    assert.equal(SIGN_IN_FAILED_MESSAGE.includes("<script>"), false);
    assert.equal(PILOT_NOT_APPROVED_MESSAGE.includes("exists"), false);
  });
});
