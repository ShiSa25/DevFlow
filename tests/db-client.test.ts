import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Pool } from "pg";
import { getDb } from "../src/db/client";

const databaseUrl = "postgres://devflow:secret@127.0.0.1:1/devflow";
const otherDatabaseUrl = "postgres://devflow:other@127.0.0.1:1/other";
const pools: Pool[] = [];
const env = process.env as { NODE_ENV?: string };

function restoreNodeEnv(previous: string | undefined): void {
  if (previous === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = previous;
  }
}

after(async () => {
  globalThis.__devflowPgPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
});

describe("database client", () => {
  it("does not create a pool when DATABASE_URL is missing", () => {
    assert.equal(globalThis.__devflowPgPool, undefined);

    assert.throws(() => getDb({}), /DATABASE_URL is not set/);
    assert.throws(() => getDb({ DATABASE_URL: "   " }), /DATABASE_URL is not set/);

    assert.equal(globalThis.__devflowPgPool, undefined);
  });

  it("reuses one lazy development pool and logs idle errors without credentials", () => {
    const previous = process.env.NODE_ENV;
    env.NODE_ENV = "development";

    try {
      const db = getDb({ DATABASE_URL: databaseUrl });
      const pool = db.$client;
      pools.push(pool);

      assert.equal(pool.totalCount, 0);
      assert.equal(pool.idleCount, 0);
      assert.equal(globalThis.__devflowPgPool, pool);
      assert.equal(pool.listenerCount("error"), 1);
      assert.equal(getDb({ DATABASE_URL: otherDatabaseUrl }), db);
      assert.equal(getDb({ DATABASE_URL: otherDatabaseUrl }).$client, pool);
      assert.equal(pool.totalCount, 0);
      assert.throws(() => getDb({}), /DATABASE_URL is not set/);
      assert.equal(globalThis.__devflowPgPool, pool);

      const logged: string[] = [];
      const original = console.error;
      console.error = (message?: unknown, ...rest: unknown[]) => {
        logged.push([message, ...rest].map(String).join(" "));
      };

      try {
        const error = new Error(
          "idle connection terminated postgres://devflow:secret@127.0.0.1:5432/devflow",
        ) as Error & { code: string };
        error.code = "ECONNRESET";
        pool.emit("error", error);
      } finally {
        console.error = original;
      }

      assert.deepEqual(logged, [
        "PostgreSQL pool error: ECONNRESET: idle connection terminated [redacted]",
      ]);
    } finally {
      restoreNodeEnv(previous);
    }
  });

  it("keeps the production pool on the module and off globalThis", () => {
    const previous = process.env.NODE_ENV;
    env.NODE_ENV = "production";
    globalThis.__devflowPgPool = undefined;

    try {
      const db = getDb({ DATABASE_URL: databaseUrl });
      const pool = db.$client;
      pools.push(pool);

      assert.equal(globalThis.__devflowPgPool, undefined);
      assert.equal(pool.totalCount, 0);
      assert.equal(pool.listenerCount("error"), 1);
      assert.equal(getDb({ DATABASE_URL: otherDatabaseUrl }).$client, pool);
    } finally {
      restoreNodeEnv(previous);
    }
  });
});
