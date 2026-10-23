import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const ADMIN_URLS = [
  "postgres://devflow:devflow@127.0.0.1:5432/postgres",
  "postgres://devflow:devflow@127.0.0.1:5432/devflow",
];

const TEST_DATABASE_NAME = /^devflow_(auth|project)_test_[a-f0-9]+$/;

export function assertIsolatedAuthTestDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing to use an unreadable database URL");
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("Refusing to use a database that is not local Postgres");
  }

  const name = parsed.pathname.replace(/^\//, "");
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`Refusing to migrate or query database "${name || "(none)"}"`);
  }
}

async function connectAdmin(): Promise<pg.Client> {
  let lastError: unknown;
  for (const url of ADMIN_URLS) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
    }
  }
  throw new Error(
    `Could not connect to local Postgres to create an isolated test database: ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
  );
}

function quoteIdent(name: string): string {
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`Refusing to quote unexpected database name "${name}"`);
  }
  return `"${name}"`;
}

export async function createIsolatedDatabase(kind: "auth" | "project" = "auth"): Promise<string> {
  const name = `devflow_${kind}_test_${randomBytes(8).toString("hex")}`;
  const admin = await connectAdmin();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
  } finally {
    await admin.end();
  }
  const url = `postgres://devflow:devflow@127.0.0.1:5432/${name}`;
  assertIsolatedAuthTestDatabase(url);
  return url;
}

export async function migrateIsolatedDatabase(url: string): Promise<void> {
  assertIsolatedAuthTestDatabase(url);
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

export async function dropIsolatedDatabase(url: string): Promise<void> {
  assertIsolatedAuthTestDatabase(url);
  const name = new URL(url).pathname.replace(/^\//, "");
  const admin = await connectAdmin();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
