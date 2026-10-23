import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { getAuth } from "../../src/auth/server";
import { getDb } from "../../src/db/client";
import { account, session, user } from "../../src/db/schema";

export async function seedPilot(options: {
  id: string;
  name: string;
  githubId: string;
}): Promise<string> {
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
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  const signature = await makeSignature(token, secret);
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  const loaded = await getAuth().api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(loaded?.user.id, options.id);
  assert.equal(loaded?.user.name, options.name);
  return cookie;
}
