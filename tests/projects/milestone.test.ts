import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  assertIsolatedAuthTestDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  migrateIsolatedDatabase,
} from "../auth/database";
import { CHANGES_SAVED_MESSAGE, FIELD_MESSAGES } from "../../src/projects/messages";
import { createInputFromFormData } from "../../src/projects/validation";
import { ChromePage } from "./cdp-browser";

const SECRET = "test-secret-must-be-at-least-32-characters";
const ORIGIN = "http://127.0.0.1:3000";
const ADA_ID = "user-ada";
const BYRON_ID = "user-byron";
const GRACE_ID = "user-grace";

type Ops = typeof import("../../src/projects/operations");
type DbModule = typeof import("../../src/db/client");
type SchemaModule = typeof import("../../src/db/schema");
type ProjectRow = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

let databaseUrl = "";
let appLoaded = false;
let ops: Ops;
let dbModule: DbModule;
let schemaModule: SchemaModule;
let adaCookie = "";
let byronCookie = "";
let graceCookie = "";

function projectUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function headersFor(cookie?: string): Headers {
  const headers = new Headers();
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return headers;
}

function notFoundResult() {
  return { ok: false as const, code: "not_found" as const };
}

function stamp(row: ProjectRow) {
  return {
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function anchorHasHref(body: string, id: string, href: string): boolean {
  const tags = body.match(/<a\b[^>]*>/gi) ?? [];
  return tags.some((tag) => tag.includes(`id="${id}"`) && tag.includes(`href="${href}"`));
}

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
}

async function resetProjects(): Promise<void> {
  await dbModule.getDb().delete(schemaModule.project);
}

async function readRow(id: string): Promise<ProjectRow | null> {
  const rows = await dbModule
    .getDb()
    .select()
    .from(schemaModule.project)
    .where(eq(schemaModule.project.id, id));
  return (rows[0] as ProjectRow | undefined) ?? null;
}

async function insertProject(values: {
  id: string;
  ownerId: string;
  name: string;
  description?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Promise<void> {
  await dbModule.getDb().insert(schemaModule.project).values({
    id: values.id,
    ownerId: values.ownerId,
    name: values.name,
    description: values.description ?? null,
    archivedAt: values.archivedAt ?? null,
    createdAt: values.createdAt,
    updatedAt: values.updatedAt,
  });
}

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GITHUB_CLIENT_ID: "test-github-client-id",
    GITHUB_CLIENT_SECRET: "test-github-client-secret",
    PILOT_GITHUB_USER_IDS: "1001,1002",
  };
  delete env.BETTER_AUTH_TRUSTED_ORIGINS;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env as NodeJS.ProcessEnv;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

async function waitForHttp(url: string): Promise<void> {
  let lastError = "no response";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1_000) });
      if (response.status > 0) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not accept requests: ${lastError}`);
}

async function withServer(
  extra: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<string> {
  const child = spawn("npm", ["run", "start"], {
    cwd: process.cwd(),
    env: childEnv(extra),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs += chunk.toString();
  });
  try {
    await waitForHttp(`${ORIGIN}/`);
    await run();
    return logs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? "" : "";
    throw new Error(`${redact(message)}\n${redact(stack)}\n${redact(logs)}`);
  } finally {
    await stopServer(child);
  }
}

async function request(path: string, cookie?: string): Promise<{ status: number; body: string; location: URL | undefined }> {
  const headers = new Headers({ accept: "text/html" });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  const response = await fetch(`${ORIGIN}${path}`, { headers, redirect: "manual" });
  const body = (await response.text()).replaceAll("<!-- -->", "");
  const locationHeader = response.headers.get("location");
  let location: URL | undefined;
  if (locationHeader) {
    location = new URL(locationHeader, ORIGIN);
  } else {
    const meta = body.match(/http-equiv="refresh"[^>]*url=([^";]+)/i);
    const digest = body.match(/NEXT_REDIRECT;replace;([^;]+);307;/);
    const target = meta?.[1] ?? digest?.[1];
    if (target) {
      location = new URL(target, ORIGIN);
    }
  }
  return { status: response.status, body, location };
}

describe("milestone 3 projects", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DATABASE_URL;
    databaseUrl = await createIsolatedDatabase("project");
    assertIsolatedAuthTestDatabase(databaseUrl);
    try {
      await migrateIsolatedDatabase(databaseUrl);
      process.env.DATABASE_URL = databaseUrl;
      process.env.BETTER_AUTH_SECRET = SECRET;
      process.env.BETTER_AUTH_URL = ORIGIN;
      process.env.GITHUB_CLIENT_ID = "test-github-client-id";
      process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";
      process.env.PILOT_GITHUB_USER_IDS = "1001,1002";
      delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      ops = await import("../../src/projects/operations");
      dbModule = await import("../../src/db/client");
      schemaModule = await import("../../src/db/schema");
      appLoaded = true;
      const { seedPilot } = await import("./seed");
      adaCookie = await seedPilot({ id: ADA_ID, name: "Ada Lovelace", githubId: "1001" });
      byronCookie = await seedPilot({ id: BYRON_ID, name: "Byron Kent", githubId: "1002" });
      graceCookie = await seedPilot({ id: GRACE_ID, name: "Grace Hopper", githubId: "1003" });
    } catch (error) {
      await dropIsolatedDatabase(databaseUrl);
      databaseUrl = "";
      throw error;
    }
  }, { timeout: 60_000 });

  after(async () => {
    if (appLoaded) {
      await dbModule.getDb().$client.end().catch(() => undefined);
    }
    if (databaseUrl) {
      await dropIsolatedDatabase(databaseUrl);
    }
  });

  it("creates a trimmed active project for the session user", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const created = await ops.createProject(ada, {
      name: "  Shared Name  ",
      description: "  ",
    });
    assert.equal(created.ok, true);
    if (!created.ok) {
      return;
    }
    assert.equal(created.code, "success");
    assert.equal(created.project.name, "Shared Name");
    assert.equal(created.project.description, null);
    assert.equal(created.project.archivedAt, null);
    assert.equal(created.project.createdAt, created.project.updatedAt);
    const row = await readRow(created.project.id);
    assert.ok(row);
    assert.equal(row.ownerId, ADA_ID);
    assert.equal("ownerId" in created.project, false);

    const duplicate = await ops.createProject(ada, { name: "Shared Name", description: "Notes" });
    assert.equal(duplicate.ok, true);
    if (duplicate.ok) {
      assert.notEqual(duplicate.project.id, created.project.id);
    }
  });

  it("rejects a client owner id and still assigns the session user", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const rejected = await ops.createProject(ada, {
      name: "Owned by Ada",
      description: "No",
      ownerId: BYRON_ID,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.code, "invalid");
      assert.equal(JSON.stringify(rejected).includes(BYRON_ID), false);
    }
    assert.equal(await dbModule.getDb().select().from(schemaModule.project).then((rows) => rows.length), 0);

    const form = new FormData();
    form.set("name", "From the form");
    form.set("description", "Kept");
    form.set("ownerId", BYRON_ID);
    const created = await ops.createProject(ada, createInputFromFormData(form));
    assert.equal(created.ok, true);
    if (created.ok) {
      const row = await readRow(created.project.id);
      assert.equal(row?.ownerId, ADA_ID);
      assert.equal(row?.name, "From the form");
    }
  });

  it("leaves stored projects unchanged when validation fails", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const id = projectUuid(1);
    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    await insertProject({
      id,
      ownerId: ADA_ID,
      name: "Stable",
      description: "Original",
      createdAt,
      updatedAt: createdAt,
    });
    const before = await readRow(id);
    assert.ok(before);

    const failures = [
      { name: "   ", description: "x" },
      { name: "a".repeat(101), description: "x" },
      { name: "Ok", description: "a".repeat(5001) },
      { name: 12, description: "x" },
      { name: "Ok", description: { repeated: true } },
    ];
    for (const input of failures) {
      const result = await ops.updateProject(ada, { id, ...input });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "invalid");
      }
      const after = await readRow(id);
      assert.ok(after);
      assert.deepEqual(stamp(after), stamp(before));
    }

    const created = await ops.createProject(ada, { name: " ", description: "nope" });
    assert.equal(created.ok, false);
    const rows = await dbModule.getDb().select().from(schemaModule.project);
    assert.equal(rows.length, 1);
  });

  it("keeps unauthenticated and unapproved results distinct and does not write", async () => {
    await resetProjects();
    const id = projectUuid(2);
    const when = new Date("2024-02-01T00:00:00.000Z");
    await insertProject({
      id,
      ownerId: ADA_ID,
      name: "Do not touch",
      description: null,
      createdAt: when,
      updatedAt: when,
    });
    const before = await readRow(id);
    const calls = [
      (headers: Headers) => ops.listProjects(headers, { view: ["active", "archived"], page: "nope" }),
      (headers: Headers) => ops.getProject(headers, "not-a-uuid"),
      (headers: Headers) => ops.createProject(headers, { name: "" }),
      (headers: Headers) => ops.updateProject(headers, { id: "not-a-uuid", name: "" }),
      (headers: Headers) => ops.archiveProject(headers, { id: "not-a-uuid" }),
      (headers: Headers) => ops.restoreProject(headers, { id: "not-a-uuid" }),
      (headers: Headers) => ops.deleteProject(headers, { id, confirm: "delete" }),
    ];
    for (const call of calls) {
      const anonymous = await call(headersFor());
      const unapproved = await call(headersFor(graceCookie));
      assert.deepEqual(anonymous, { ok: false, code: "unauthenticated" });
      assert.deepEqual(unapproved, { ok: false, code: "unapproved" });
      assert.notEqual(anonymous.code, unapproved.code);
    }
    const after = await readRow(id);
    assert.ok(before);
    assert.ok(after);
    assert.deepEqual(stamp(after), stamp(before));
  });

  it("filters the list by owner and archive state", async () => {
    await resetProjects();
    const older = new Date("2024-03-01T00:00:00.000Z");
    const newer = new Date("2024-03-02T00:00:00.000Z");
    await insertProject({
      id: projectUuid(1),
      ownerId: ADA_ID,
      name: "Shared Name",
      createdAt: older,
      updatedAt: older,
    });
    await insertProject({
      id: projectUuid(2),
      ownerId: ADA_ID,
      name: "Ada archived",
      archivedAt: older,
      createdAt: older,
      updatedAt: newer,
    });
    await insertProject({
      id: projectUuid(3),
      ownerId: BYRON_ID,
      name: "Shared Name",
      createdAt: newer,
      updatedAt: newer,
    });

    const active = await ops.listProjects(headersFor(adaCookie), {});
    assert.equal(active.ok, true);
    if (active.ok) {
      assert.equal(active.view, "active");
      assert.equal(active.page, 1);
      assert.equal(active.pageSize, 25);
      assert.equal(active.total, 1);
      assert.deepEqual(active.projects.map((item) => item.id), [projectUuid(1)]);
    }

    const archived = await ops.listProjects(headersFor(adaCookie), { view: "archived" });
    assert.equal(archived.ok, true);
    if (archived.ok) {
      assert.equal(archived.total, 1);
      assert.deepEqual(archived.projects.map((item) => item.name), ["Ada archived"]);
    }

    const byron = await ops.listProjects(headersFor(byronCookie), { view: "active" });
    assert.equal(byron.ok, true);
    if (byron.ok) {
      assert.deepEqual(byron.projects.map((item) => item.id), [projectUuid(3)]);
    }
  });

  it("paginates by updated_at descending and then id descending", async () => {
    await resetProjects();
    const base = new Date("2026-01-01T00:00:00.000Z");
    for (let n = 1; n <= 26; n += 1) {
      const seconds = n === 25 ? 26 : n;
      const at = new Date(base.getTime() + seconds * 1000);
      await insertProject({
        id: projectUuid(n),
        ownerId: ADA_ID,
        name: `P${n}`,
        createdAt: at,
        updatedAt: at,
      });
    }
    await insertProject({
      id: projectUuid(255),
      ownerId: BYRON_ID,
      name: "Byron newest",
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    const expected = [26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map(projectUuid);
    const page1 = await ops.listProjects(headersFor(adaCookie), { page: "1" });
    assert.equal(page1.ok, true);
    if (page1.ok) {
      assert.equal(page1.total, 26);
      assert.equal(page1.projects.length, 25);
      assert.deepEqual(page1.projects.map((item) => item.id), expected);
      assert.equal(page1.projects.some((item) => item.name === "Byron newest"), false);
    }

    const page2 = await ops.listProjects(headersFor(adaCookie), { page: "2" });
    assert.equal(page2.ok, true);
    if (page2.ok) {
      assert.deepEqual(page2.projects.map((item) => item.id), [projectUuid(1)]);
    }

    const page3 = await ops.listProjects(headersFor(adaCookie), { page: "3" });
    assert.equal(page3.ok, true);
    if (page3.ok) {
      assert.deepEqual(page3.projects, []);
      assert.equal(page3.total, 26);
    }
  });

  it("rejects invalid list parameters before returning projects", async () => {
    await resetProjects();
    await insertProject({
      id: projectUuid(1),
      ownerId: ADA_ID,
      name: "Visible",
      createdAt: new Date("2024-04-01T00:00:00.000Z"),
      updatedAt: new Date("2024-04-01T00:00:00.000Z"),
    });
    const cases = [
      { view: ["active", "archived"] },
      { view: "sideways" },
      { page: "0" },
      { page: "01" },
      { page: ["1", "2"] },
      { page: "nope" },
    ];
    for (const input of cases) {
      const result = await ops.listProjects(headersFor(adaCookie), input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "invalid");
        assert.equal("projects" in result, false);
        assert.equal(JSON.stringify(result).includes("Visible"), false);
      }
    }
  });

  it("returns the same not_found result for a missing project and another owner's project", async () => {
    await resetProjects();
    const missing = projectUuid(240);
    const owned = projectUuid(4);
    const other = projectUuid(5);
    const when = new Date("2024-05-01T00:00:00.000Z");
    await insertProject({
      id: owned,
      ownerId: ADA_ID,
      name: "Ada visible",
      description: "Ada secret",
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: other,
      ownerId: BYRON_ID,
      name: "Byron hidden",
      description: "Byron secret",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });

    const ada = headersFor(adaCookie);
    const missingResult = await ops.getProject(ada, missing);
    const otherResult = await ops.getProject(ada, other);
    assert.deepEqual(missingResult, notFoundResult());
    assert.deepEqual(otherResult, notFoundResult());
    assert.deepEqual(missingResult, otherResult);

    const upper = await ops.getProject(ada, owned.toUpperCase());
    assert.equal(upper.ok, true);
    if (upper.ok) {
      assert.equal(upper.project.name, "Ada visible");
      assert.equal(upper.project.archivedAt, null);
    }

    const malformed = await ops.getProject(ada, "not-a-uuid");
    assert.deepEqual(malformed, {
      ok: false,
      code: "invalid",
      fieldErrors: { id: FIELD_MESSAGES.id },
    });

    const archivedOwned = projectUuid(6);
    await insertProject({
      id: archivedOwned,
      ownerId: ADA_ID,
      name: "Ada old",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });
    const archived = await ops.getProject(ada, archivedOwned);
    assert.equal(archived.ok, true);
    if (archived.ok) {
      assert.equal(archived.project.name, "Ada old");
      assert.ok(archived.project.archivedAt);
    }
  });

  it("updates an active project and rejects an archived one without writing", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const activeId = projectUuid(7);
    const archivedId = projectUuid(8);
    const otherId = projectUuid(9);
    const when = new Date("2020-01-01T00:00:00.000Z");
    await insertProject({
      id: activeId,
      ownerId: ADA_ID,
      name: "Before",
      description: "Old",
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: archivedId,
      ownerId: ADA_ID,
      name: "Frozen",
      description: "Stay",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: otherId,
      ownerId: BYRON_ID,
      name: "Byron frozen",
      description: "Hidden",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });

    const updated = await ops.updateProject(ada, {
      id: activeId,
      name: "  After  ",
      description: "  New text  ",
    });
    assert.equal(updated.ok, true);
    if (updated.ok) {
      assert.equal(updated.project.name, "After");
      assert.equal(updated.project.description, "New text");
      assert.equal(updated.project.createdAt, when.toISOString());
      assert.ok(updated.project.updatedAt > when.toISOString());
    }

    const archivedBefore = await readRow(archivedId);
    const archivedUpdate = await ops.updateProject(ada, {
      id: archivedId,
      name: "Changed",
      description: "Changed",
    });
    assert.deepEqual(archivedUpdate, { ok: false, code: "archived" });
    const archivedAfter = await readRow(archivedId);
    assert.ok(archivedBefore);
    assert.ok(archivedAfter);
    assert.deepEqual(stamp(archivedAfter), stamp(archivedBefore));

    const missing = await ops.updateProject(ada, { id: projectUuid(241), name: "Nope", description: "" });
    const other = await ops.updateProject(ada, { id: otherId, name: "Nope", description: "" });
    assert.deepEqual(missing, notFoundResult());
    assert.deepEqual(other, notFoundResult());
    const otherRow = await readRow(otherId);
    assert.equal(otherRow?.name, "Byron frozen");
    assert.equal(otherRow?.description, "Hidden");
  });

  it("archives and restores once, then leaves timestamps unchanged", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const id = projectUuid(10);
    const when = new Date("2020-06-01T00:00:00.000Z");
    await insertProject({
      id,
      ownerId: ADA_ID,
      name: "Cycle",
      description: "Same",
      createdAt: when,
      updatedAt: when,
    });

    const archived = await ops.archiveProject(ada, { id });
    assert.equal(archived.ok, true);
    const archivedRow = await readRow(id);
    assert.ok(archivedRow?.archivedAt);
    assert.ok(archivedRow.updatedAt.getTime() > when.getTime());
    assert.equal(archivedRow.createdAt.toISOString(), when.toISOString());
    assert.equal(archivedRow.name, "Cycle");

    const archivedAgain = await ops.archiveProject(ada, { id });
    assert.equal(archivedAgain.ok, true);
    const archivedStill = await readRow(id);
    assert.ok(archivedStill);
    assert.deepEqual(stamp(archivedStill), stamp(archivedRow));

    const restored = await ops.restoreProject(ada, { id });
    assert.equal(restored.ok, true);
    if (restored.ok) {
      assert.equal(restored.project.archivedAt, null);
      assert.ok(restored.project.updatedAt > archivedRow.updatedAt.toISOString());
    }
    const restoredRow = await readRow(id);
    assert.equal(restoredRow?.archivedAt, null);

    const restoredAgain = await ops.restoreProject(ada, { id });
    assert.equal(restoredAgain.ok, true);
    const restoredStill = await readRow(id);
    assert.ok(restoredRow);
    assert.ok(restoredStill);
    assert.deepEqual(stamp(restoredStill), stamp(restoredRow));
  });

  it("does not archive or restore a missing project or another owner's project", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const otherId = projectUuid(11);
    const when = new Date("2021-01-01T00:00:00.000Z");
    await insertProject({
      id: otherId,
      ownerId: BYRON_ID,
      name: "Byron active",
      createdAt: when,
      updatedAt: when,
    });
    const before = await readRow(otherId);
    const missingId = projectUuid(242);
    for (const call of [
      () => ops.archiveProject(ada, { id: missingId }),
      () => ops.archiveProject(ada, { id: otherId }),
      () => ops.restoreProject(ada, { id: missingId }),
      () => ops.restoreProject(ada, { id: otherId }),
    ]) {
      assert.deepEqual(await call(), notFoundResult());
    }
    const malformed = await ops.archiveProject(ada, { id: "not-a-uuid" });
    assert.equal(malformed.ok, false);
    if (!malformed.ok) {
      assert.equal(malformed.code, "invalid");
    }
    const after = await readRow(otherId);
    assert.ok(before);
    assert.ok(after);
    assert.deepEqual(stamp(after), stamp(before));
  });

  it("requires the delete confirmation and deletes owned active or archived projects", async () => {
    await resetProjects();
    const ada = headersFor(adaCookie);
    const activeId = projectUuid(12);
    const archivedId = projectUuid(13);
    const otherId = projectUuid(14);
    const when = new Date("2022-01-01T00:00:00.000Z");
    await insertProject({ id: activeId, ownerId: ADA_ID, name: "Active", createdAt: when, updatedAt: when });
    await insertProject({
      id: archivedId,
      ownerId: ADA_ID,
      name: "Archived",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({ id: otherId, ownerId: BYRON_ID, name: "Other", createdAt: when, updatedAt: when });

    for (const input of [
      { id: activeId },
      { id: activeId, confirm: "Delete" },
      { id: activeId, confirm: "yes" },
      { id: projectUuid(243) },
      { id: "not-a-uuid", confirm: "delete" },
      { id: activeId, confirm: "delete", ownerId: BYRON_ID },
    ]) {
      const result = await ops.deleteProject(ada, input);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "invalid");
      }
    }
    assert.ok(await readRow(activeId));

    const missing = await ops.deleteProject(ada, { id: projectUuid(244), confirm: "delete" });
    const other = await ops.deleteProject(ada, { id: otherId, confirm: "delete" });
    assert.deepEqual(missing, notFoundResult());
    assert.deepEqual(other, notFoundResult());
    assert.equal((await readRow(otherId))?.name, "Other");

    const removedActive = await ops.deleteProject(ada, { id: activeId, confirm: "delete" });
    const removedArchived = await ops.deleteProject(ada, { id: archivedId, confirm: "delete" });
    assert.deepEqual(removedActive, { ok: true, code: "success" });
    assert.deepEqual(removedArchived, { ok: true, code: "success" });
    assert.equal(await readRow(activeId), null);
    assert.equal(await readRow(archivedId), null);
    assert.ok(await readRow(otherId));
  });

  it("enforces the project table constraints and does not create tasks", async () => {
    const task = await dbModule.getDb().$client.query("select to_regclass('public.task') as task");
    assert.equal(task.rows[0]?.task, null);

    const index = await dbModule.getDb().$client.query(
      "select indexdef from pg_indexes where schemaname = 'public' and indexname = 'project_owner_list_idx'",
    );
    const indexDef = String(index.rows[0]?.indexdef ?? "");
    assert.match(indexDef, /owner_id/);
    assert.match(indexDef, /updated_at DESC/);
    assert.match(indexDef, /id DESC/);

    const foreignKey = await dbModule.getDb().$client.query(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'project_owner_id_user_id_fk'",
    );
    const foreignKeyDef = String(foreignKey.rows[0]?.def ?? "");
    assert.match(foreignKeyDef, /user/i);
    assert.match(foreignKeyDef, /ON DELETE CASCADE/i);

    const when = new Date("2023-01-01T00:00:00.000Z");
    const base = {
      ownerId: ADA_ID,
      createdAt: when,
      updatedAt: when,
      archivedAt: null,
    };
    await assert.rejects(() =>
      dbModule.getDb().insert(schemaModule.project).values({ ...base, name: "", description: null }),
    );
    await assert.rejects(() =>
      dbModule.getDb().insert(schemaModule.project).values({
        ...base,
        name: "a".repeat(101),
        description: null,
      }),
    );
    await assert.rejects(() =>
      dbModule.getDb().insert(schemaModule.project).values({
        ...base,
        name: "Ok",
        description: "a".repeat(5001),
      }),
    );

    const inserted = await dbModule
      .getDb()
      .insert(schemaModule.project)
      .values({ ...base, name: "Generated", description: null })
      .returning({ id: schemaModule.project.id });
    assert.match(inserted[0]?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const tempUser = "user-temp-cascade";
    await dbModule.getDb().insert(schemaModule.user).values({
      id: tempUser,
      name: "Temp",
      email: "1099@users.noreply.devflow.invalid",
      emailVerified: false,
      image: null,
      createdAt: when,
      updatedAt: when,
    });
    const cascadeId = projectUuid(200);
    await insertProject({
      id: cascadeId,
      ownerId: tempUser,
      name: "Goes away",
      createdAt: when,
      updatedAt: when,
    });
    await dbModule.getDb().delete(schemaModule.user).where(eq(schemaModule.user.id, tempUser));
    assert.equal(await readRow(cascadeId), null);
  });

  it("serves project routes for the approved owner only", async () => {
    assert.equal(existsSync(".next"), true, "run npm run build before project request checks");
    await resetProjects();
    const when = new Date("2024-07-01T00:00:00.000Z");
    const visibleId = projectUuid(30);
    const archivedId = projectUuid(31);
    const hiddenId = projectUuid(32);
    const plainId = projectUuid(33);
    await insertProject({
      id: visibleId,
      ownerId: ADA_ID,
      name: "Ada Visible",
      description: "Visible body",
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: archivedId,
      ownerId: ADA_ID,
      name: "Ada Archived",
      description: "Old body",
      archivedAt: when,
      createdAt: when,
      updatedAt: new Date(when.getTime() + 1000),
    });
    await insertProject({
      id: hiddenId,
      ownerId: BYRON_ID,
      name: "Byron Hidden",
      description: "Hidden body",
      archivedAt: when,
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: plainId,
      ownerId: ADA_ID,
      name: "Ada Plain",
      description: "<script>alert(1)</script>",
      createdAt: when,
      updatedAt: new Date(when.getTime() + 2000),
    });

    const logs = await withServer({}, async () => {
      const home = await request("/");
      assert.equal(home.status, 200);
      assert.match(home.body, /Application scaffold is running/);

      const anonymous = await request("/projects");
      assert.equal(anonymous.location?.pathname, "/sign-in");
      assert.equal(anonymous.location?.searchParams.get("error") ?? null, null);
      assert.equal(anonymous.body.includes("Create project"), false);
      assert.equal(anonymous.body.includes("Ada Visible"), false);

      const anonymousDetail = await request(`/projects/${visibleId}`);
      assert.equal(anonymousDetail.location?.pathname, "/sign-in");
      assert.equal(anonymousDetail.body.includes("Ada Visible"), false);

      const unapproved = await request("/projects", graceCookie);
      assert.equal(unapproved.location?.pathname, "/sign-in");
      assert.equal(unapproved.location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(unapproved.body.includes("Create project"), false);
      assert.equal(unapproved.body.includes("Ada Visible"), false);
      assert.equal(unapproved.body.includes("Grace Hopper"), false);

      const unapprovedDetail = await request(`/projects/${visibleId}`, graceCookie);
      assert.equal(unapprovedDetail.location?.pathname, "/sign-in");
      assert.equal(unapprovedDetail.location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(unapprovedDetail.body.includes("Visible body"), false);

      const dashboard = await request("/dashboard", adaCookie);
      assert.equal(dashboard.status, 200, `dashboard status ${dashboard.status} location ${dashboard.location?.pathname ?? ""}`);
      assert.match(dashboard.body, /Signed in as Ada Lovelace/);
      assert.match(dashboard.body, /href="\/projects"/);
      assert.equal(dashboard.body.includes("Active projects"), false);
      assert.equal(dashboard.body.includes("Open tasks"), false);

      const list = await request("/projects", adaCookie);
      assert.equal(list.status, 200);
      assert.match(list.body, /Create project/);
      assert.match(list.body, /Ada Visible/);
      assert.match(list.body, /Ada Plain/);
      assert.equal(list.body.includes("Ada Archived"), false);
      assert.equal(list.body.includes("Byron Hidden"), false);
      assert.equal(anchorHasHref(list.body, "project-view-active", "/projects"), true);
      assert.equal(anchorHasHref(list.body, "project-view-archived", "/projects?view=archived"), true);

      const archivedList = await request("/projects?view=archived&page=2", adaCookie);
      assert.equal(archivedList.status, 200);
      assert.match(archivedList.body, /No projects on this page/);
      assert.equal(archivedList.body.includes("Ada Archived"), false);
      assert.equal(anchorHasHref(archivedList.body, "project-view-archived", "/projects?view=archived"), true);
      assert.equal(anchorHasHref(archivedList.body, "project-view-active", "/projects"), true);

      const archivedPage = await request("/projects?view=archived", adaCookie);
      assert.match(archivedPage.body, /Ada Archived/);
      assert.equal(archivedPage.body.includes("Ada Visible"), false);
      assert.equal(archivedPage.body.includes("Byron Hidden"), false);

      const invalid = await request("/projects?view=active&view=archived", adaCookie);
      assert.match(invalid.body, /Those project filters are not valid/);
      assert.equal(invalid.body.includes("Ada Visible"), false);
      const badPage = await request("/projects?page=0", adaCookie);
      assert.match(badPage.body, /Those project filters are not valid/);
      assert.equal(badPage.body.includes("Ada Visible"), false);

      const pastEnd = await request("/projects?page=2", adaCookie);
      assert.match(pastEnd.body, /No projects on this page/);
      assert.equal(pastEnd.body.includes("Ada Visible"), false);

      const detail = await request(`/projects/${visibleId}`, adaCookie);
      assert.equal(detail.status, 200);
      assert.match(detail.body, /Ada Visible/);
      assert.match(detail.body, /Visible body/);
      assert.match(detail.body, /Save changes/);
      assert.match(detail.body, /Archive project/);
      assert.match(detail.body, /Delete project/);

      const plain = await request(`/projects/${plainId}`, adaCookie);
      assert.equal(plain.body.includes("<script>alert(1)</script>"), false);
      assert.match(plain.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

      const archivedDetail = await request(`/projects/${archivedId}`, adaCookie);
      assert.match(archivedDetail.body, /Ada Archived/);
      assert.match(archivedDetail.body, /Restore project/);
      assert.match(archivedDetail.body, /Delete project/);
      assert.equal(archivedDetail.body.includes("Save changes"), false);
      assert.equal(archivedDetail.body.includes("Archive project"), false);

      const missing = await request(`/projects/${projectUuid(245)}`, adaCookie);
      const foreign = await request(`/projects/${hiddenId}`, adaCookie);
      const malformed = await request("/projects/not-a-uuid", adaCookie);
      assert.equal(missing.status, foreign.status);
      assert.equal(missing.status, malformed.status);
      for (const response of [missing, foreign, malformed]) {
        assert.match(response.body, /Project not found/);
        assert.match(response.body, /That project is not available/);
        assert.equal(response.body.includes("Byron Hidden"), false);
        assert.equal(response.body.includes("Hidden body"), false);
        assert.equal(response.body.includes("Ada Visible"), false);
        assert.equal(response.body.includes("Old body"), false);
      }
    });
    assert.equal(logs.includes("test-github-client-secret"), false);
    assert.equal(logs.toLowerCase().includes("neon.tech"), false);
  });

  it("rejects project routes when the allowlist is empty or malformed", async () => {
    assert.equal(existsSync(".next"), true, "run npm run build before project request checks");
    await withServer({ PILOT_GITHUB_USER_IDS: "" }, async () => {
      const response = await request("/projects", adaCookie);
      assert.equal(response.location?.pathname, "/sign-in");
      assert.equal(response.location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(response.body.includes("Create project"), false);
    });
    await withServer({ PILOT_GITHUB_USER_IDS: "1001,nope" }, async () => {
      const response = await request(`/projects/${projectUuid(30)}`, adaCookie);
      assert.equal(response.location?.pathname, "/sign-in");
      assert.equal(response.location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(response.body.includes("Ada Visible"), false);
    });
  });

  it("does not render projects when the database is unset", async () => {
    assert.equal(existsSync(".next"), true, "run npm run build before project request checks");
    const logs = await withServer(
      {
        DATABASE_URL: undefined,
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_URL: undefined,
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: undefined,
        PILOT_GITHUB_USER_IDS: undefined,
      },
      async () => {
        const home = await request("/");
        assert.equal(home.status, 200);
        assert.match(home.body, /Application scaffold is running/);
        const projects = await request("/projects", adaCookie);
        assert.equal(projects.body.includes("Create project"), false);
        assert.equal(projects.body.includes("Ada Visible"), false);
        assert.equal(projects.body.includes("Signed in as"), false);
      },
    );
    assert.equal(logs.includes("postgres://"), false);
  });

  it("keeps the edit confirmation after the server refreshes the project", async () => {
    assert.equal(existsSync(".next"), true, "run npm run build before project request checks");
    await resetProjects();
    const editedId = projectUuid(40);
    const otherId = projectUuid(41);
    const when = new Date("2024-08-01T00:00:00.000Z");
    await insertProject({
      id: editedId,
      ownerId: ADA_ID,
      name: "Original name",
      description: "Original notes",
      createdAt: when,
      updatedAt: when,
    });
    await insertProject({
      id: otherId,
      ownerId: ADA_ID,
      name: "Other project",
      description: "Other notes",
      createdAt: when,
      updatedAt: new Date(when.getTime() + 1000),
    });

    const chrome = new ChromePage();
    try {
      await withServer({}, async () => {
        const cookieValue = decodeURIComponent(adaCookie.slice("better-auth.session_token=".length));
        await chrome.open(ORIGIN, cookieValue);
        await chrome.goto(`${ORIGIN}/projects/${editedId}`);
        await waitForProject(chrome, "Original name", "Original notes");
        await chrome.evaluate<boolean>(`new Promise((resolve, reject) => {
          const started = Date.now();
          const timer = setInterval(() => {
            const form = document.querySelector("#edit-project-name")?.form;
            if (!form) {
              return;
            }
            const names = Object.getOwnPropertyNames(form).concat(
              Object.getOwnPropertySymbols(form).map((symbol) => String(symbol)),
            );
            if (names.some((name) => name.toLowerCase().includes("react"))) {
              clearInterval(timer);
              resolve(true);
              return;
            }
            if (Date.now() - started > 8000) {
              clearInterval(timer);
              reject(new Error("Edit form did not hydrate"));
            }
          }, 50);
        })`);
        await chrome.evaluate<boolean>(`(() => {
          const setValue = (selector, value) => {
            const element = document.querySelector(selector);
            if (!element) {
              throw new Error("Missing " + selector);
            }
            const prototype = element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
            setter.call(element, value);
            element.dispatchEvent(new Event("input", { bubbles: true }));
          };
          setValue("#edit-project-name", "  Renamed project  ");
          setValue("#edit-project-description", "  Updated notes  ");
          document.querySelector("#edit-project-name").form.requestSubmit();
          return true;
        })()`);

        const saved = await waitForProject(chrome, "Renamed project", "Updated notes", true);
        assert.equal(saved.saved, true);
        assert.equal(saved.name, "Renamed project");
        assert.equal(saved.notes, "Updated notes");
        await new Promise((resolve) => setTimeout(resolve, 600));
        const settled = await projectSnapshot(chrome);
        assert.equal(settled.heading, "Renamed project");
        assert.equal(settled.description, "Updated notes");
        assert.equal(settled.name, "Renamed project");
        assert.equal(settled.notes, "Updated notes");
        assert.equal(settled.saved, true);
        assert.equal(settled.message, CHANGES_SAVED_MESSAGE);

        await chrome.evaluate(`(() => {
          const link = document.createElement("a");
          link.href = ${JSON.stringify(`${ORIGIN}/projects/${otherId}`)};
          document.body.appendChild(link);
          link.click();
          return true;
        })()`);
        const other = await waitForProject(chrome, "Other project", "Other notes");
        assert.equal(other.saved, false);
        assert.equal(other.name, "Other project");
        assert.equal(other.notes, "Other notes");
      });
    } finally {
      await chrome.close();
    }

    const savedRow = await readRow(editedId);
    assert.equal(savedRow?.name, "Renamed project");
    assert.equal(savedRow?.description, "Updated notes");
  });
});

type ProjectSnapshot = {
  heading: string;
  description: string;
  name: string;
  notes: string;
  saved: boolean;
  message: string;
};

async function projectSnapshot(chrome: ChromePage): Promise<ProjectSnapshot> {
  return chrome.evaluate<ProjectSnapshot>(`(() => {
    const message = document.querySelector("#edit-project-form-error");
    return {
      heading: document.querySelector("h1")?.textContent ?? "",
      description: document.querySelector(".project-description")?.textContent ?? "",
      name: document.querySelector("#edit-project-name")?.value ?? "",
      notes: document.querySelector("#edit-project-description")?.value ?? "",
      saved: (message?.textContent ?? "") === ${JSON.stringify(CHANGES_SAVED_MESSAGE)},
      message: message?.textContent ?? "",
    };
  })()`);
}

async function waitForProject(
  chrome: ChromePage,
  heading: string,
  description: string,
  saved = false,
): Promise<ProjectSnapshot> {
  let last: ProjectSnapshot = {
    heading: "",
    description: "",
    name: "",
    notes: "",
    saved: false,
    message: "",
  };
  let lastError = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      last = await projectSnapshot(chrome);
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message.split("\n")[0] : "snapshot failed";
      last = { heading: "", description: "", name: "", notes: "", saved: false, message: "" };
    }
    if (
      last.heading === heading &&
      last.description === description &&
      last.name === heading &&
      last.notes === description &&
      last.saved === saved
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const pageText = await chrome.evaluate<string>(
    `location.href + " | " + (document.body?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 180)`,
  ).catch(() => lastError);
  throw new Error(
    `Project page did not show ${heading}. Last heading ${last.heading}, name ${last.name}, saved ${String(last.saved)}. ${pageText}`,
  );
}
