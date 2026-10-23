import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readDatabaseUrl, type EnvSource } from "../config/env";
import * as schema from "./schema";

declare global {
  var __devflowPgPool: Pool | undefined;
}

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

const CONNECTION_URL = /postgres(?:ql)?:\/\/\S+/gi;

let pool: Pool | undefined;
let database: Database | undefined;

function describePoolError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown database pool error";
  const redacted = message.replace(CONNECTION_URL, "[redacted]");
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  return code ? `${code}: ${redacted}` : redacted;
}

function handlePoolError(error: unknown): void {
  console.error(`PostgreSQL pool error: ${describePoolError(error)}`);
}

function createPool(url: string): Pool {
  const created = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  created.on("error", handlePoolError);
  return created;
}

function getPool(url: string): Pool {
  if (process.env.NODE_ENV === "development") {
    if (!globalThis.__devflowPgPool) {
      globalThis.__devflowPgPool = createPool(url);
    }
    return globalThis.__devflowPgPool;
  }

  if (!pool) {
    pool = createPool(url);
  }
  return pool;
}

export function getDb(env?: EnvSource): Database {
  const url = readDatabaseUrl(env);
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const activePool = getPool(url);
  if (!database || database.$client !== activePool) {
    database = drizzle({ client: activePool, schema });
  }
  return database;
}
