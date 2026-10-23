import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { makeSignature } from "better-auth/crypto";
import { randomBytes } from "node:crypto";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { getAuth, requirePilot } from "../../src/auth/server";
import { getDb } from "../../src/db/client";
import { account, session, user, verification } from "../../src/db/schema";
import { assertIsolatedAuthTestDatabase } from "./database";

const SENTINEL_TOKEN = "devflow-test-access-token";
const SENTINEL_CODE = "devflow-test-auth-code";
const ORIGIN = "http://127.0.0.1:3000";

type GithubProfile = {
  id: number;
  email: string | null;
  name: string;
  login: string;
};

const networkCalls: string[] = [];

function installGithubFetch(profile: GithubProfile): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    const target = `${method} ${url.origin}${url.pathname}`;
    networkCalls.push(target);
    if (url.origin !== "https://github.com" && url.origin !== "https://api.github.com") {
      throw new Error(`Refusing unexpected network request ${target}`);
    }
    if (url.origin === "https://github.com" && url.pathname === "/login/oauth/access_token") {
      return Response.json({
        access_token: SENTINEL_TOKEN,
        token_type: "bearer",
        scope: "read:user",
      });
    }
    if (url.origin === "https://api.github.com" && url.pathname === "/user") {
      return Response.json({
        login: profile.login,
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar_url: `https://avatars.githubusercontent.com/u/${profile.id}`,
      });
    }
    if (url.origin === "https://api.github.com" && url.pathname === "/user/emails") {
      return Response.json({ message: "Not Found" }, { status: 404 });
    }
    throw new Error(`Refusing unexpected GitHub request ${target}`);
  };
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0] ?? "")
    .filter((entry) => entry.includes("="))
    .join("; ");
}

function redirectTarget(response: Response): URL | undefined {
  const location = response.headers.get("location");
  if (!location) {
    return undefined;
  }
  return new URL(location, ORIGIN);
}

async function postJson(path: string, body: unknown, cookie?: string, origin = ORIGIN): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    origin,
  });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return POST(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function readUrl(response: Response): Promise<URL> {
  const location = response.headers.get("location");
  if (location) {
    return new URL(location, ORIGIN);
  }
  const text = await response.text();
  const parsed = JSON.parse(text) as { url?: string };
  if (!parsed.url) {
    throw new Error(`No redirect URL in auth response ${response.status}: ${text}`);
  }
  return new URL(parsed.url);
}

async function tableCounts(): Promise<{ users: number; accounts: number; sessions: number }> {
  const db = getDb();
  const [users, accounts, sessions] = await Promise.all([
    db.select({ id: user.id }).from(user),
    db.select({ id: account.id }).from(account),
    db.select({ id: session.id }).from(session),
  ]);
  return { users: users.length, accounts: accounts.length, sessions: sessions.length };
}

async function accountRow(githubId: string) {
  const rows = await getDb().select().from(account).where(eq(account.accountId, githubId));
  return rows;
}

function assertTokensNull(row: {
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}): void {
  assert.equal(row.accessToken, null);
  assert.equal(row.refreshToken, null);
  assert.equal(row.idToken, null);
  assert.equal(row.accessTokenExpiresAt, null);
  assert.equal(row.refreshTokenExpiresAt, null);
}

async function assertSentinelAbsent(): Promise<void> {
  const db = getDb();
  const [users, accounts, sessions, verifications] = await Promise.all([
    db.select().from(user),
    db.select().from(account),
    db.select().from(session),
    db.select().from(verification),
  ]);
  const stored = JSON.stringify({ users, accounts, sessions, verifications });
  assert.equal(stored.includes(SENTINEL_TOKEN), false);
  assert.equal(stored.includes(SENTINEL_CODE), false);
  assert.equal(stored.includes("test-github-client-secret"), false);
}

async function startGitHubSignIn(cookie?: string): Promise<{ state: string; cookie: string; authorize: URL }> {
  const response = await postJson("/api/auth/sign-in/social", {
    provider: "github",
    callbackURL: "/dashboard",
    errorCallbackURL: "/sign-in",
  }, cookie);
  assert.ok(response.status < 400, `sign-in status ${response.status}`);
  const authorize = await readUrl(response);
  assert.equal(authorize.origin, "https://github.com");
  assert.equal(authorize.pathname, "/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/callback/github`);
  assert.equal(authorize.searchParams.get("scope"), "read:user");
  assert.ok(authorize.searchParams.get("code_challenge"));
  const state = authorize.searchParams.get("state");
  assert.ok(state);
  const nextCookie = [cookie, cookieHeader(response)].filter(Boolean).join("; ");
  return { state, cookie: nextCookie, authorize };
}

async function finishGitHubSignIn(state: string, cookie: string): Promise<Response> {
  return GET(
    new Request(
      `${ORIGIN}/api/auth/callback/github?code=${encodeURIComponent(SENTINEL_CODE)}&state=${encodeURIComponent(state)}`,
      { headers: { cookie, origin: ORIGIN } },
    ),
  );
}

async function signInGithub(profile: GithubProfile): Promise<{
  response: Response;
  redirect: URL | undefined;
  cookie: string;
  calls: string[];
}> {
  networkCalls.length = 0;
  installGithubFetch(profile);
  const started = await startGitHubSignIn();
  const response = await finishGitHubSignIn(started.state, started.cookie);
  const redirect = redirectTarget(response);
  const sessionCookie = cookieHeader(response);
  return { response, redirect, cookie: sessionCookie || started.cookie, calls: [...networkCalls] };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function seedUser(options: { id: string; name: string; githubId: string }): Promise<string> {
  const db = getDb();
  const now = new Date();
  const token = randomBytes(32).toString("hex");
  await db.insert(user).values({
    id: options.id,
    name: options.name,
    email: `${options.githubId}@users.noreply.devflow.invalid`,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(account).values({
    id: `${options.id}-account`,
    userId: options.id,
    providerId: "github",
    accountId: options.githubId,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: "read:user",
    password: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(session).values({
    id: `${options.id}-session`,
    userId: options.id,
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ipAddress: null,
    userAgent: null,
    createdAt: now,
    updatedAt: now,
  });
  const signature = await makeSignature(token, requiredEnv("BETTER_AUTH_SECRET"));
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  const loaded = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(loaded?.user.id, options.id);
  assert.equal(loaded?.user.name, options.name);
  return cookie;
}

async function oauthApprovedFirst(): Promise<unknown> {
  const before = await tableCounts();
  assert.deepEqual(before, { users: 0, accounts: 0, sessions: 0 });

  const rejected = await postJson("/api/auth/sign-in/social", {
    provider: "github",
    callbackURL: "https://evil.example/phish",
    errorCallbackURL: "/sign-in",
  });
  const rejectedText = await rejected.text();
  assert.ok(
    rejected.status >= 400,
    `foreign callback status ${rejected.status} body ${rejectedText}`,
  );
  assert.equal(rejected.headers.get("location")?.includes("evil.example") ?? false, false);
  assert.deepEqual(await tableCounts(), before);

  const outcome = await signInGithub({
    id: 2001,
    email: "ada@example.com",
    name: "Ada Pilot",
    login: "adapilot",
  });
  assert.equal(outcome.redirect?.pathname, "/dashboard");
  assert.ok(outcome.calls.some((call) => call.includes("https://github.com/login/oauth/access_token")));
  assert.ok(outcome.calls.some((call) => call.includes("https://api.github.com/user")));
  assert.ok(outcome.calls.some((call) => call.includes("https://api.github.com/user/emails")));

  const rows = await accountRow("2001");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.providerId, "github");
  assertTokensNull(rows[0]!);
  const owner = await getDb().select().from(user).where(eq(user.id, rows[0]!.userId));
  assert.equal(owner.length, 1);
  assert.equal(owner[0]?.email, "2001@users.noreply.devflow.invalid");
  assert.equal(owner[0]?.emailVerified, false);
  assert.equal(owner[0]?.name, "Ada Pilot");
  assert.equal(owner[0]?.email.includes("ada@example.com"), false);
  const sessions = await getDb().select().from(session).where(eq(session.userId, owner[0]!.id));
  assert.equal(sessions.length, 1);
  await assertSentinelAbsent();
  const loaded = await getAuth().api.getSession({ headers: new Headers({ cookie: outcome.cookie }) });
  assert.equal(loaded?.user.id, owner[0]?.id);

  const csrf = await postJson(
    "/api/auth/sign-in/social",
    { provider: "github", callbackURL: "/dashboard", errorCallbackURL: "/sign-in" },
    outcome.cookie,
    "https://evil.example",
  );
  assert.ok(csrf.status >= 400, `cross-site sign-in status ${csrf.status}`);

  return {
    userId: owner[0]?.id,
    cookie: outcome.cookie,
    counts: await tableCounts(),
    scope: rows[0]?.scope ?? null,
  };
}

async function oauthApprovedReturn(): Promise<unknown> {
  const before = await tableCounts();
  const outcome = await signInGithub({
    id: 2001,
    email: "ada@example.com",
    name: "Ada Pilot",
    login: "adapilot",
  });
  assert.equal(outcome.redirect?.pathname, "/dashboard");
  const rows = await accountRow("2001");
  assert.equal(rows.length, 1);
  assertTokensNull(rows[0]!);
  const sessions = await getDb().select().from(session).where(eq(session.userId, rows[0]!.userId));
  assert.equal(sessions.length, 2);
  const after = await tableCounts();
  assert.equal(after.users, before.users);
  assert.equal(after.accounts, before.accounts);
  assert.equal(after.sessions, before.sessions + 1);
  await assertSentinelAbsent();
  return { counts: after };
}

async function oauthPrivateEmail(): Promise<unknown> {
  const before = await tableCounts();
  const outcome = await signInGithub({
    id: 2004,
    email: null,
    name: "Private Email",
    login: "privateemail",
  });
  assert.equal(outcome.redirect?.pathname, "/dashboard");
  const rows = await accountRow("2004");
  assert.equal(rows.length, 1);
  assertTokensNull(rows[0]!);
  const owner = await getDb().select().from(user).where(eq(user.id, rows[0]!.userId));
  assert.equal(owner[0]?.email, "2004@users.noreply.devflow.invalid");
  assert.equal(owner[0]?.emailVerified, false);
  const after = await tableCounts();
  assert.equal(after.users, before.users + 1);
  assert.equal(after.accounts, before.accounts + 1);
  assert.equal(after.sessions, before.sessions + 1);
  await assertSentinelAbsent();
  return { email: owner[0]?.email, emailVerified: owner[0]?.emailVerified };
}

async function oauthUnapproved(): Promise<unknown> {
  const before = await tableCounts();
  const outcome = await signInGithub({
    id: 2002,
    email: "grace@example.com",
    name: "Grace Unapproved",
    login: "grace",
  });
  assert.equal(outcome.redirect?.pathname, "/sign-in");
  assert.equal(outcome.redirect?.searchParams.get("error"), "pilot_not_approved");
  assert.deepEqual(await tableCounts(), before);
  assert.equal((await accountRow("2002")).length, 0);
  await assertSentinelAbsent();
  return { status: outcome.response.status, error: outcome.redirect?.searchParams.get("error") };
}

async function oauthRemoved(): Promise<unknown> {
  const userId = requiredEnv("PREVIOUS_USER_ID");
  const cookie = requiredEnv("PREVIOUS_COOKIE");
  const beforeSessions = await getDb().select().from(session).where(eq(session.userId, userId));
  const outcome = await signInGithub({
    id: 2003,
    email: null,
    name: "Removed Pilot",
    login: "removed",
  });
  assert.equal(outcome.redirect?.pathname, "/sign-in");
  assert.equal(outcome.redirect?.searchParams.get("error"), "pilot_not_approved");
  const afterSessions = await getDb().select().from(session).where(eq(session.userId, userId));
  assert.equal(afterSessions.length, beforeSessions.length);
  const admission = await requirePilot(new Headers({ cookie }));
  const sessionResult = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(admission.status, "unapproved");
  assert.equal(sessionResult?.user.id, userId);
  await assertSentinelAbsent();
  return { admission: admission.status, sessionUser: sessionResult?.user.id ?? null };
}

async function oauthCreateRemovedUser(): Promise<unknown> {
  const outcome = await signInGithub({
    id: 2003,
    email: null,
    name: "Removed Pilot",
    login: "removed",
  });
  assert.equal(outcome.redirect?.pathname, "/dashboard");
  const rows = await accountRow("2003");
  assert.equal(rows.length, 1);
  assertTokensNull(rows[0]!);
  const loaded = await getAuth().api.getSession({ headers: new Headers({ cookie: outcome.cookie }) });
  assert.equal(loaded?.user.id, rows[0]?.userId);
  return { userId: rows[0]?.userId, cookie: outcome.cookie };
}

async function seedSessions(): Promise<unknown> {
  const ada = await seedUser({ id: "user-ada", name: "Ada Lovelace", githubId: "1001" });
  const grace = await seedUser({ id: "user-grace", name: "Grace Hopper", githubId: "9999" });
  return { ada, grace };
}

async function admission(): Promise<unknown> {
  const ada = requiredEnv("SEEDED_ADA_COOKIE");
  const grace = requiredEnv("SEEDED_GRACE_COOKIE");
  const missing = await requirePilot(new Headers());
  const garbage = await requirePilot(
    new Headers({ cookie: "better-auth.session_token=not-a-signed-token" }),
  );
  const approved = await requirePilot(new Headers({ cookie: ada }));
  const unapproved = await requirePilot(new Headers({ cookie: grace }));
  process.env["PILOT_GITHUB_USER_IDS"] = "";
  const stillApproved = await requirePilot(new Headers({ cookie: ada }));
  return {
    missing: missing.status,
    garbage: garbage.status,
    approved: approved.status,
    approvedName: approved.status === "approved" ? approved.user.name : null,
    unapproved: unapproved.status,
    stillApprovedAfterEnvEdit: stillApproved.status,
  };
}

async function admissionCookie(): Promise<unknown> {
  const ada = requiredEnv("SEEDED_ADA_COOKIE");
  const admissionResult = await requirePilot(new Headers({ cookie: ada }));
  return { status: admissionResult.status };
}

async function signOutCase(): Promise<unknown> {
  const cookie = requiredEnv("SEEDED_ADA_COOKIE");
  const before = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  assert.ok(before?.session.token);
  const response = await postJson("/api/auth/sign-out", {}, cookie);
  assert.ok(response.status < 400, `sign-out status ${response.status}`);
  const after = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  const remaining = await getDb().select().from(session).where(eq(session.token, before.session.token));
  assert.equal(after, null);
  assert.equal(remaining.length, 0);
  return { status: response.status };
}

async function trustedOrigins(): Promise<unknown> {
  assert.throws(() => getAuth(), /BETTER_AUTH_TRUSTED_ORIGINS/);
  assert.throws(() => getAuth(), /BETTER_AUTH_TRUSTED_ORIGINS/);
  return { rejected: true };
}

const cases: Record<string, () => Promise<unknown>> = {
  "oauth-approved-first": oauthApprovedFirst,
  "oauth-approved-return": oauthApprovedReturn,
  "oauth-private-email": oauthPrivateEmail,
  "oauth-unapproved": oauthUnapproved,
  "oauth-create-removed": oauthCreateRemovedUser,
  "oauth-removed": oauthRemoved,
  "seed-sessions": seedSessions,
  admission,
  "admission-cookie": admissionCookie,
  "sign-out": signOutCase,
  "trusted-origins": trustedOrigins,
};

async function main(): Promise<void> {
  assertIsolatedAuthTestDatabase(process.env.DATABASE_URL ?? "");
  const name = process.argv[2] ?? "";
  const run = cases[name];
  if (!run) {
    throw new Error(`Unknown auth case "${name}"`);
  }
  try {
    const value = await run();
    process.stdout.write(`AUTH_CASE_RESULT ${JSON.stringify(value)}\n`);
  } finally {
    try {
      await getDb().$client.end();
    } catch {
      // The pool was never created.
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
