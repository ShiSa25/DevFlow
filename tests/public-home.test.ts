import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("public home", () => {
  it("does not import auth or the database client", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    for (const source of [page, layout]) {
      assert.equal(source.includes("getAuth"), false);
      assert.equal(source.includes("getDb"), false);
      assert.equal(source.includes("src/auth"), false);
      assert.equal(source.includes("src/db"), false);
    }
    assert.match(page, /Application scaffold is running/);
  });
});
