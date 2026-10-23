import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readDatabaseUrl, type EnvSource } from "../config/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let database: Database | undefined;

export function getDb(env?: EnvSource): Database {
  const url = readDatabaseUrl(env);
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!database) {
    database = drizzle({
      client: new Pool({
        connectionString: url,
        max: 10,
        connectionTimeoutMillis: 5_000,
      }),
      schema,
    });
  }

  return database;
}
