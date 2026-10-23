import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, describe, it } from "node:test";

const composeDatabaseUrl = "postgres://devflow:devflow@localhost:5432/devflow";
const inheritedDatabaseUrl = "postgres://unrelated:secret@db.example:5432/other";
const directories: string[] = [];

after(() => {
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database-smoke.sh", () => {
  it("migrates and queries the Compose database when DATABASE_URL is inherited", () => {
    const directory = mkdtempSync(join(tmpdir(), "devflow-smoke-"));
    directories.push(directory);
    const logPath = join(directory, "commands.log");
    const bin = join(directory, "bin");
    mkdirSync(bin);
    writeFileSync(logPath, "");
    const command = `#!/bin/sh
printf 'DATABASE_URL=%s\\nARGS=%s\\n' "$DATABASE_URL" "$*" >> "$SMOKE_LOG"
exit 0
`;
    for (const name of ["docker", "npm"]) {
      const path = join(bin, name);
      writeFileSync(path, command);
      chmodSync(path, 0o755);
    }

    const result = spawnSync("bash", ["scripts/database-smoke.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: inheritedDatabaseUrl,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        SMOKE_LOG: logPath,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const log = readFileSync(logPath, "utf8");
    const urls = [...log.matchAll(/^DATABASE_URL=(.*)$/gm)].map((match) => match[1]);

    assert.ok(urls.length >= 2);
    for (const url of urls) {
      assert.equal(url, composeDatabaseUrl);
    }
    assert.match(log, /ARGS=run db:migrate/);
    assert.match(log, /ARGS=run db:smoke/);
    assert.equal(log.includes("db.example"), false);
    assert.equal(log.includes("unrelated"), false);
  });
});
