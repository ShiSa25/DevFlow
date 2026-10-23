import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { parsePilotGithubUserIds } from "../src/config/pilot-allowlist";

describe("pilot allowlist parser", () => {
  it("treats unset, empty, and whitespace as an empty allowlist", () => {
    assert.deepEqual(parsePilotGithubUserIds(undefined), { status: "empty" });
    assert.deepEqual(parsePilotGithubUserIds(""), { status: "empty" });
    assert.deepEqual(parsePilotGithubUserIds("   "), { status: "empty" });
  });

  it("accepts canonical decimal ids and ignores surrounding spaces", () => {
    const parsed = parsePilotGithubUserIds("123, 456");
    assert.equal(parsed.status, "ready");
    if (parsed.status !== "ready") {
      return;
    }
    assert.deepEqual([...parsed.ids], ["123", "456"]);
    assert.equal(parsed.ids.has("123"), true);
    assert.equal(parsed.ids.has("0123"), false);
  });

  it("collapses duplicate ids into one ready set", () => {
    const parsed = parsePilotGithubUserIds("123,123");
    assert.equal(parsed.status, "ready");
    if (parsed.status !== "ready") {
      return;
    }
    assert.deepEqual([...parsed.ids], ["123"]);
  });

  it("rejects a malformed token without keeping the valid ones", () => {
    for (const raw of ["123,", "123,456,", "0123", "+1", "-1", "1.5", "abc", "123,abc", ",123", "123,,456"]) {
      assert.deepEqual(parsePilotGithubUserIds(raw), { status: "malformed" }, raw);
    }
  });
});

describe("pilot allowlist load", () => {
  it("logs empty and malformed results without the raw value", () => {
    const empty = spawnSync(process.execPath, ["--import", "tsx", "tests/pilot-allowlist-log.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PILOT_GITHUB_USER_IDS: "   " },
    });
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /^empty\n/);
    assert.match(empty.stderr, /Pilot allowlist is empty/);
    assert.equal(empty.stderr.includes("PILOT_GITHUB_USER_IDS"), false);

    const malformed = spawnSync(process.execPath, ["--import", "tsx", "tests/pilot-allowlist-log.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PILOT_GITHUB_USER_IDS: "123,not-an-id" },
    });
    assert.equal(malformed.status, 0, malformed.stderr);
    assert.match(malformed.stdout, /^malformed\n/);
    assert.match(malformed.stderr, /Pilot allowlist is malformed/);
    assert.equal(malformed.stderr.includes("not-an-id"), false);
    assert.equal(malformed.stderr.includes("123,not-an-id"), false);
  });
});
