import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { loadEnvFile } from "../scripts/db-smoke";

const directories: string[] = [];

after(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeEnvFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "devflow-env-"));
  directories.push(directory);
  const filePath = join(directory, ".env");
  writeFileSync(filePath, contents);
  return filePath;
}

describe("db:smoke environment loading", () => {
  it("reads a synthetic DATABASE_URL from .env when none is exported", () => {
    const filePath = writeEnvFile(`
# synthetic configuration
DATABASE_URL="postgres://file-user:file-secret@127.0.0.1:9/from_file"
`);
    const env: { [key: string]: string | undefined } = {};

    loadEnvFile(filePath, env);

    assert.equal(env.DATABASE_URL, "postgres://file-user:file-secret@127.0.0.1:9/from_file");
  });

  it("keeps an exported DATABASE_URL ahead of .env", () => {
    const filePath = writeEnvFile(
      "DATABASE_URL=postgres://file-user:file-secret@127.0.0.1:9/from_file\n",
    );
    const env: { [key: string]: string | undefined } = {
      DATABASE_URL: "postgres://exported-user:exported-secret@127.0.0.1:9/exported",
    };

    loadEnvFile(filePath, env);

    assert.equal(
      env.DATABASE_URL,
      "postgres://exported-user:exported-secret@127.0.0.1:9/exported",
    );
  });
});
