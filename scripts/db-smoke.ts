import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown database error";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

function fail(message: string): void {
  console.error(`Database smoke check failed: ${message}`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
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

main().catch((error: unknown) => {
  fail(safeMessage(error));
});
