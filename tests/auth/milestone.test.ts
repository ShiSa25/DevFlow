import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  assertIsolatedAuthTestDatabase,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  migrateIsolatedDatabase,
} from "./database";

const SECRET = "test-secret-must-be-at-least-32-characters";
const ORIGIN = "http://127.0.0.1:3000";
const SENTINEL_TOKEN = "devflow-test-access-token";

let databaseUrl = "";
let adaCookie = "";
let graceCookie = "";

function childEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Better Auth skips its origin check when NODE_ENV is test. Production keeps that check on.
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GITHUB_CLIENT_ID: "test-github-client-id",
    GITHUB_CLIENT_SECRET: "test-github-client-secret",
  };
  delete env.BETTER_AUTH_TRUSTED_ORIGINS;
  delete env.BETTER_AUTH_TELEMETRY;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env as NodeJS.ProcessEnv;
}

function runCase(name: string, extra: Record<string, string | undefined> = {}): Record<string, unknown> {
  assertIsolatedAuthTestDatabase(databaseUrl);
  const result = spawnSync(process.execPath, ["--import", "tsx", "tests/auth/run-case.ts", name], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: childEnv(extra),
    timeout: 60_000,
  });
  assert.equal(
    result.status,
    0,
    `${name} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.stderr.includes(SENTINEL_TOKEN), false);
  assert.equal(result.stderr.includes("test-github-client-secret"), false);
  const line = result.stdout
    .split("\n")
    .find((entry) => entry.startsWith("AUTH_CASE_RESULT "));
  assert.ok(line, `No result from ${name}\n${result.stdout}`);
  return JSON.parse(line.slice("AUTH_CASE_RESULT ".length)) as Record<string, unknown>;
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
  env: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<string> {
  const serverEnv = childEnv({ ...env, NODE_ENV: "production" });
  const child = spawn("npm", ["run", "start"], {
    cwd: process.cwd(),
    env: serverEnv,
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
    throw new Error(`${error instanceof Error ? error.message : error}\n${logs}`);
  } finally {
    await stopServer(child);
  }
}

async function request(path: string, cookie?: string): Promise<Response> {
  const headers = new Headers({ accept: "text/html" });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return fetch(`${ORIGIN}${path}`, { headers, redirect: "manual" });
}

function redirectTarget(response: Response, body: string): URL | undefined {
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, ORIGIN);
  }
  const meta = body.match(/http-equiv="refresh"[^>]*url=([^";]+)/i);
  if (meta?.[1]) {
    return new URL(meta[1], ORIGIN);
  }
  const digest = body.match(/NEXT_REDIRECT;replace;([^;]+);307;/);
  if (digest?.[1]) {
    return new URL(digest[1], ORIGIN);
  }
  return undefined;
}

describe("milestone 2 authentication", { concurrency: 1 }, () => {
  before(async () => {
    databaseUrl = await createIsolatedDatabase();
    try {
      await migrateIsolatedDatabase(databaseUrl);
    } catch (error) {
      await dropIsolatedDatabase(databaseUrl);
      databaseUrl = "";
      throw error;
    }
  });

  after(async () => {
    if (databaseUrl) {
      await dropIsolatedDatabase(databaseUrl);
    }
  });

  it("rejects extra trusted origins before building auth", () => {
    const result = runCase("trusted-origins", { BETTER_AUTH_TRUSTED_ORIGINS: "https://evil.example" });
    assert.equal(result.rejected, true);
  });

  it("signs in an approved GitHub user through the real handler", () => {
    const result = runCase("oauth-approved-first", { PILOT_GITHUB_USER_IDS: "2001,2003" });
    const counts = result.counts as { users: number; accounts: number; sessions: number };
    assert.deepEqual(counts, { users: 1, accounts: 1, sessions: 1 });
    assert.equal(result.scope, "read:user");
  });

  it("signs in the same approved user again without a second account", () => {
    const result = runCase("oauth-approved-return", { PILOT_GITHUB_USER_IDS: "2001,2003" });
    const counts = result.counts as { users: number; accounts: number; sessions: number };
    assert.deepEqual(counts, { users: 1, accounts: 1, sessions: 2 });
  });

  it("maps a private GitHub email to the synthetic address", () => {
    const result = runCase("oauth-private-email", { PILOT_GITHUB_USER_IDS: "2001,2003,2004" });
    assert.equal(result.email, "2004@users.noreply.devflow.invalid");
    assert.equal(result.emailVerified, false);
  });

  it("does not create rows for an unapproved first-time GitHub user", () => {
    const result = runCase("oauth-unapproved", { PILOT_GITHUB_USER_IDS: "2001,2003,2004" });
    assert.equal(result.error, "pilot_not_approved");
  });

  it("refuses a removed pilot after a fresh configuration load", () => {
    const created = runCase("oauth-create-removed", { PILOT_GITHUB_USER_IDS: "2003" });
    const removed = runCase("oauth-removed", {
      PILOT_GITHUB_USER_IDS: "1001",
      PREVIOUS_USER_ID: String(created.userId),
      PREVIOUS_COOKIE: String(created.cookie),
    });
    assert.equal(removed.admission, "unapproved");
    assert.equal(removed.sessionUser, created.userId);
  });

  it("admits seeded sessions only when the loaded allowlist contains the GitHub id", () => {
    const seeded = runCase("seed-sessions", { PILOT_GITHUB_USER_IDS: "1001" });
    adaCookie = String(seeded.ada);
    graceCookie = String(seeded.grace);

    const approved = runCase("admission", {
      PILOT_GITHUB_USER_IDS: "1001",
      SEEDED_ADA_COOKIE: adaCookie,
      SEEDED_GRACE_COOKIE: graceCookie,
    });
    assert.equal(approved.missing, "unauthenticated");
    assert.equal(approved.garbage, "unauthenticated");
    assert.equal(approved.approved, "approved");
    assert.equal(approved.approvedName, "Ada Lovelace");
    assert.equal(approved.unapproved, "unapproved");
    assert.equal(approved.stillApprovedAfterEnvEdit, "approved");

    const empty = runCase("admission-cookie", {
      PILOT_GITHUB_USER_IDS: "",
      SEEDED_ADA_COOKIE: adaCookie,
    });
    assert.equal(empty.status, "unapproved");

    const malformed = runCase("admission-cookie", {
      PILOT_GITHUB_USER_IDS: "1001,nope",
      SEEDED_ADA_COOKIE: adaCookie,
    });
    assert.equal(malformed.status, "unapproved");

    const profile = runCase("removed-profile-mutation", {
      PILOT_GITHUB_USER_IDS: "1001",
      SEEDED_GRACE_COOKIE: graceCookie,
    });
    assert.equal(profile.updateStatus, 404);
    assert.equal(profile.name, "Grace Hopper");
    assert.equal(profile.admission, "unapproved");
  });

  it("serves the public pages and the minimal dashboard over HTTP", async () => {
    assert.equal(existsSync(".next"), true, "run npm run build before auth request checks");
    assert.ok(adaCookie);
    assert.ok(graceCookie);

    const unsetLogs = await withServer(
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
        const homeText = await home.text();
        assert.match(homeText, /Application scaffold is running/);
        assert.equal(homeText.includes("Signed in as"), false);

        const homeWithCookie = await request("/", adaCookie);
        assert.equal(homeWithCookie.status, 200);
        const cookieText = await homeWithCookie.text();
        assert.match(cookieText, /Application scaffold is running/);
        assert.equal(cookieText.includes("Signed in as"), false);

        const signIn = await request("/sign-in");
        assert.equal(signIn.status, 200);
        const signInText = await signIn.text();
        assert.match(signInText, /Continue with GitHub/);
        assert.equal(signInText.includes("Signed in as"), false);

        const dashboard = await request("/dashboard");
        const dashboardText = await dashboard.text();
        assert.equal(dashboard.status, 200);
        assert.equal(dashboardText.includes("Signed in as"), false);
        assert.equal(dashboardText.includes("Application scaffold is running."), false);
        const authProbe = await request("/api/auth/get-session");
        assert.equal(authProbe.status, 500);
      },
    );
    assert.equal(unsetLogs.includes("postgres://"), false);

    await withServer({ PILOT_GITHUB_USER_IDS: "1001" }, async () => {
      const signIn = await request("/sign-in");
      assert.equal(signIn.status, 200);
      assert.match(await signIn.text(), /Continue with GitHub/);

      const session = await request("/api/auth/get-session");
      assert.equal(session.status, 200);
      assert.equal((await session.text()).trim(), "null");

      const anonymous = await request("/dashboard");
      const anonymousText = await anonymous.text();
      const anonymousLocation = redirectTarget(anonymous, anonymousText);
      assert.equal(anonymousLocation?.pathname, "/sign-in", anonymousText.slice(0, 500));
      assert.equal(anonymousLocation?.searchParams.get("error") ?? null, null);
      assert.equal(anonymousText.includes("Signed in as"), false);

      const unapproved = await request("/dashboard", graceCookie);
      const unapprovedText = await unapproved.text();
      const unapprovedLocation = redirectTarget(unapproved, unapprovedText);
      assert.equal(unapprovedLocation?.pathname, "/sign-in", unapprovedText.slice(0, 500));
      assert.equal(unapprovedLocation?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(unapprovedText.includes("Signed in as"), false);
      assert.equal(unapprovedText.includes("Grace Hopper"), false);
      assert.equal(unapprovedText.includes("Ada Lovelace"), false);

      const approved = await request("/dashboard", adaCookie);
      assert.equal(approved.status, 200);
      const approvedText = await approved.text();
      const approvedVisible = approvedText.replaceAll("<!-- -->", "");
      assert.match(approvedVisible, /Signed in as Ada Lovelace/);
      assert.equal(approvedText.includes("Grace Hopper"), false);
      assert.equal(approvedText.includes("Active projects"), false);
      assert.equal(approvedText.includes("Open tasks"), false);
    });

    await withServer({ PILOT_GITHUB_USER_IDS: "" }, async () => {
      const response = await request("/dashboard", adaCookie);
      const body = await response.text();
      const location = redirectTarget(response, body);
      assert.equal(location?.pathname, "/sign-in", body.slice(0, 500));
      assert.equal(location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(body.includes("Signed in as"), false);
    });

    await withServer({ PILOT_GITHUB_USER_IDS: "1001,nope" }, async () => {
      const response = await request("/dashboard", adaCookie);
      const body = await response.text();
      const location = redirectTarget(response, body);
      assert.equal(location?.pathname, "/sign-in", body.slice(0, 500));
      assert.equal(location?.searchParams.get("error"), "pilot_not_approved");
      assert.equal(body.includes("Signed in as"), false);
    });
  });

  it("signs out through the auth handler and deletes the session", () => {
    const result = runCase("sign-out", {
      PILOT_GITHUB_USER_IDS: "1001",
      SEEDED_ADA_COOKIE: adaCookie,
    });
    assert.equal(typeof result.status, "number");
  });
});
