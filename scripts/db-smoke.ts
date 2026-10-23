import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

type MutableEnv = {
  [key: string]: string | undefined;
};

export function loadEnvFile(filePath: string, env: MutableEnv = process.env): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const stripped = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = stripped.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = stripped.slice(0, separator).trim();
    if (!ENV_KEY.test(key) || env[key] !== undefined) {
      continue;
    }

    let value = stripped.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown database error";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

function fail(message: string): void {
  console.error(`Database smoke check failed: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), ".env"));

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (error) {
    fail(safeMessage(error));
    return;
  }

  try {
    const result = await db.execute(sql`select 1 as ok`);
    const value = result.rows[0]?.ok;
    if (value !== 1 && value !== "1") {
      fail("SELECT 1 returned an unexpected value");
    }
  } catch (error) {
    fail(safeMessage(error));
  } finally {
    await db.$client.end();
  }
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    fail(safeMessage(error));
  });
}
