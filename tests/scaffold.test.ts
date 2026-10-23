import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "../src/db/client";
import { getHealthSnapshot } from "../src/health/snapshot";

describe("health snapshot", () => {
  it("reports ok without contacting the database", () => {
    const started = Date.now();

    assert.deepEqual(getHealthSnapshot(), {
      status: "ok",
      database: "not contacted",
    });
    assert.ok(Date.now() - started < 500);
  });
});

describe("database client", () => {
  it("stops before opening a connection when DATABASE_URL is missing", () => {
    const started = Date.now();

    assert.throws(() => getDb({}), /DATABASE_URL is not set/);
    assert.ok(Date.now() - started < 500);
  });
});
