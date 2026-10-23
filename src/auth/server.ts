import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { isPilotGithubUser } from "../config/pilot";
import { getDb } from "../db/client";
import { account as accountTable, session as sessionTable, user, verification } from "../db/schema";
import { DISABLED_ACCOUNT_PATHS } from "./disabled-paths";
import { githubUserIdFromProfile, syntheticGithubEmail } from "./github-identity";
import { PILOT_NOT_APPROVED_CODE, PILOT_NOT_APPROVED_MESSAGE } from "./messages";

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

const authTables = {
  user,
  session: sessionTable,
  account: accountTable,
  verification,
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

type AccountRecord = {
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;
};

function discardAccountTokens<T extends AccountRecord>(record: T): { data: T } {
  return {
    data: {
      ...record,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    },
  };
}

async function githubAccountIdForUser(userId: string): Promise<string | undefined> {
  const rows = await getDb()
    .select({ accountId: accountTable.accountId })
    .from(accountTable)
    .where(and(eq(accountTable.userId, userId), eq(accountTable.providerId, "github")))
    .limit(2);

  if (rows.length !== 1) {
    return undefined;
  }
  return rows[0]?.accountId;
}

function sessionUserId(context: unknown): string | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }
  const record = context as {
    context?: { session?: { user?: { id?: unknown } } };
    session?: { user?: { id?: unknown } };
  };
  const id = record.context?.session?.user?.id ?? record.session?.user?.id;
  return typeof id === "string" && id ? id : undefined;
}

function buildAuth() {
  if (process.env["BETTER_AUTH_TRUSTED_ORIGINS"] !== undefined) {
    throw new Error(
      "BETTER_AUTH_TRUSTED_ORIGINS is set. DevFlow does not accept extra trusted origins.",
    );
  }

  const secret = requiredEnv("BETTER_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }

  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const githubClientId = requiredEnv("GITHUB_CLIENT_ID");
  const githubClientSecret = requiredEnv("GITHUB_CLIENT_SECRET");

  return betterAuth({
    baseURL,
    secret,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      transaction: true,
      schema: authTables,
    }),
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    account: {
      accountLinking: {
        enabled: false,
      },
      storeAccountCookie: false,
      updateAccountOnSignIn: false,
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
    },
    socialProviders: {
      github: {
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        disableDefaultScope: true,
        scope: ["read:user"],
        mapProfileToUser: (profile) => {
          const githubUserId = githubUserIdFromProfile(profile);
          if (!githubUserId) {
            return {};
          }
          return {
            email: syntheticGithubEmail(githubUserId),
            emailVerified: false,
          };
        },
      },
    },
    disabledPaths: [...DISABLED_ACCOUNT_PATHS],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith("/reset-password/")) {
          throw new APIError("NOT_FOUND", { message: "Not Found" });
        }
      }),
    },
    user: {
      validateUserInfo: ({ source }) => {
        const githubUserId =
          source.method === "oauth" && source.oauth?.providerId === "github"
            ? githubUserIdFromProfile(source.oauth.profile)
            : undefined;
        if (!githubUserId || !isPilotGithubUser(githubUserId)) {
          return {
            error: PILOT_NOT_APPROVED_CODE,
            errorDescription: PILOT_NOT_APPROVED_MESSAGE,
          };
        }
      },
    },
    databaseHooks: {
      user: {
        update: {
          before: async (record, context) => {
            const userId = sessionUserId(context);
            if (!userId) {
              return false;
            }
            const githubUserId = await githubAccountIdForUser(userId);
            if (!githubUserId || !isPilotGithubUser(githubUserId)) {
              return false;
            }
            return { data: record };
          },
        },
        delete: {
          before: async () => false,
        },
      },
      account: {
        create: {
          before: async (record) => discardAccountTokens(record),
        },
        update: {
          before: async (record) => discardAccountTokens(record),
        },
      },
      session: {
        create: {
          before: async (record) => {
            if (!record.userId) {
              return false;
            }
            const githubUserId = await githubAccountIdForUser(record.userId);
            if (!githubUserId || !isPilotGithubUser(githubUserId)) {
              return false;
            }
            return { data: record };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof buildAuth>;

let auth: Auth | undefined;

/**
 * Build the Better Auth instance on first use. Importing this module does
 * not connect to Postgres. The allowlist is parsed when `src/config/pilot`
 * is first loaded and is not read again per request.
 */
export function getAuth(): Auth {
  if (!auth) {
    auth = buildAuth();
  }
  return auth;
}

export type PilotAdmission =
  | { status: "approved"; user: { id: string; name: string } }
  | { status: "unauthenticated" }
  | { status: "unapproved" };

/**
 * Admit a protected server operation. Pages redirect. Other callers keep
 * the distinct `unauthenticated` and `unapproved` results. The GitHub id is
 * read from the account row and compared with the allowlist loaded for this
 * process.
 */
export async function requirePilot(requestHeaders: Headers): Promise<PilotAdmission> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return { status: "unauthenticated" };
  }

  const githubUserId = await githubAccountIdForUser(session.user.id);
  if (!githubUserId || !isPilotGithubUser(githubUserId)) {
    return { status: "unapproved" };
  }

  return {
    status: "approved",
    user: {
      id: session.user.id,
      name: session.user.name,
    },
  };
}
