# Authentication and sessions

Decision: use **Better Auth 1.7.12** with its Drizzle adapter, database sessions, and the GitHub provider only.

This repository does not install the package yet. Milestone 2 adds `better-auth` and no other authentication library. Auth.js (`next-auth`) is not a second dependency.

## Why this library

Checked on 2026-10-23 against the app that is already in this repo:

| Piece | This repo | Better Auth 1.7.12 |
| --- | --- | --- |
| Next.js | `16.4.2`, locked in `package-lock.json` | Optional peer `next: ^14.0.0 \|\| ^15.0.0 \|\| ^16.0.0`. `16.4.2` satisfies `^16.0.0`. |
| React | `19.3.0` | Optional peer `react` / `react-dom`: `^18.0.0 \|\| ^19.0.0`. |
| Drizzle ORM | `^0.45.4`, locked at `0.45.4` | Optional peer `drizzle-orm: ^0.45.2 \|\| >=1.0.0-rc.1 <2.0.0`. The locked `0.45.4` satisfies `^0.45.2`. The declared range `^0.45.4` stays inside that peer range (`>=0.45.4 <0.46.0`). |
| Drizzle Kit | `^0.31.11` | Optional peer `drizzle-kit: >=0.31.4 \|\| >=1.0.0-beta.1`. |
| PostgreSQL driver | `pg` `^8.23.1` | Optional peer `pg: ^8.0.0`. |
| Adapter | — | `@better-auth/drizzle-adapter` `1.7.12` is a direct dependency of `better-auth@1.7.12`. |

Those peer dependencies are optional, so installing the library does not force Vue, Prisma, or the other adapters. The published package date is 2026-10-20 ([v1.7.12](https://github.com/better-auth/better-auth/releases/tag/v1.7.12)). The [Next.js integration guide](https://www.better-auth.com/docs/integrations/next) says Better Auth is fully compatible with Next.js 16 and shows App Router route handlers, `auth.api.getSession` from Server Components and Server Actions, and the Next.js 16 `proxy` rename.

Auth.js was the other candidate. It is a worse fit for this repository today:

- The current Drizzle adapter, `@auth/drizzle-adapter@1.11.3`, depends on `@auth/core@0.41.3`. That core version matches `next-auth@5.0.0-beta.32`, published 2026-07-20, which is still the `beta` dist-tag. Its peer range does include `next: ^14.0.0-0 \|\| ^15.0.0 \|\| ^16.0.0`, and the adapter's own devDependency is `drizzle-orm@^0.45.2`, so a beta install would likely compile here.
- The stable `next-auth` release is `4.24.15`. It depends on `@auth/core@0.34.3`, which does not match `@auth/drizzle-adapter@1.11.3`.
- Auth.js database sessions are a configuration switch. Better Auth stores sessions in the database when a database adapter is configured, which is the session strategy this product requires.

The beta line is maintained, and its peer range does include Next.js 16. The stable line that pairs with this Drizzle adapter has not shipped. Better Auth 1.7.12 is a stable release whose published peer ranges match the versions already in this repo.

### What is verified, and what is not

Verified from registry metadata and the published `better-auth@1.7.12`, `@better-auth/core@1.7.12`, and `@better-auth/drizzle-adapter@1.7.12` packages, plus the docs linked at the end of this file:

- The peer ranges above.
- Database session rows, the 7-day expiry, and the signed session cookie described below.
- GitHub `accountId` stored with `String(profile.id)`.
- `user.validateUserInfo` running before the user insert on the OAuth create path in this version.
- The Drizzle adapter's `transaction` flag defaulting to false unless the caller sets it.

Not run, because this pull request does not install the library:

- The Milestone 2 build and request checks under [Tests](#tests).
- Any GitHub callback, including a mocked one. If a later Better Auth release moves the allowlist gate to after the user insert, or starts requiring a real email before `mapProfileToUser` can supply one, that release does not meet this design.

`cacheComponents` and `partialPrefetching` stay as they are in `next.config.ts`. Protected pages read the request session, so they stay dynamic. Private query results are rendered for that request. They do not go into a shared cache.

## Session behavior

Sessions are database rows. The browser cookie holds an opaque token. There is no JWT session plugin and no `session.cookieCache`.

Configured explicitly, matching the [session management](https://www.better-auth.com/docs/concepts/session-management) defaults:

- `session.expiresIn`: `60 * 60 * 24 * 7` (7 days).
- `session.updateAge`: `60 * 60 * 24` (1 day).

On a session read, once `updateAge` has passed since `expiresAt` was last set, Better Auth moves `expiresAt` to the current time plus `expiresIn` and refreshes the cookie. In 1.7.12 that condition is `expiresAt - expiresIn + updateAge <= now`. A session with `expiresAt` in the past is rejected, and `getSession` deletes that row. Sign-out deletes the session row and clears the cookie.

Removing someone from the pilot allowlist does not wait for this expiry. Every protected server operation checks the allowlist again, including when `getSession` still returns a row. See [Allowlist](#allowlist).

`freshAge` stays at the library default of one day. This product has no password or email-change flow that depends on it.

The Drizzle adapter is created with `provider: "pg"` and `transaction: true`. In 1.7.12 the adapter leaves `transaction` false unless the caller turns it on. PostgreSQL can wrap the new-user and account inserts in one transaction, and this app does that. The adapter receives the existing Drizzle client from `getDb()`. It does not open a second pool.

`getAuth()` builds the Better Auth instance on first use. Module import, `next build`, and the public scaffold page do not call it, so they still start when `DATABASE_URL` is unset. That preserves the current production smoke check.

## Cookie

The session cookie name is `better-auth.session_token`. When the configured base URL is `https`, 1.7.12 prefixes `__Secure-` and sets the Secure attribute. The value is the session token plus an HMAC-SHA256 signature made with `BETTER_AUTH_SECRET` (`token.signature`, the format in the 1.7.12 test helper that uses `makeSignature`). The database stores the raw token. A cookie that is only the raw token does not authenticate.

Attributes:

- `HttpOnly`: true
- `SameSite`: `Lax`
- `Path`: `/`
- `Secure`: derived from the base URL. `https` production origins get Secure cookies. Local `http://127.0.0.1:3000` does not, because a browser will not store a Secure cookie on that HTTP origin.

Set `httpOnly` and `sameSite` in `advanced.defaultCookieAttributes`. Do not set `secure` there. In 1.7.12 those default attributes are applied after the Secure flag, so an explicit `secure: false` would clear Secure on an HTTPS origin.

Leave `useSecureCookies`, `crossSubDomainCookies`, `disableCSRFCheck`, `disableOriginCheck`, and `skipStateCookieCheck` unset. Leave `BETTER_AUTH_TRUSTED_ORIGINS` unset. If that variable is present when `getAuth()` runs, `getAuth()` throws and does not construct an instance. The library would otherwise append those origins to the trusted list.

`account.storeAccountCookie` is false. With a database configured, 1.7.12 already leaves that flag off; this app sets it anyway so an account cookie cannot hold a GitHub token.

`nextCookies()` from `better-auth/next-js` is the last plugin. Server Actions that call `auth.api` need it to write cookies through `next/headers`. The sign-in button itself can use the client helper, which posts to the route handler.

## GitHub only

One OAuth App, authorization-code flow, provider id `github`. Email-and-password, other social providers, account linking, and magic links stay off.

`account.accountLinking.enabled` is false. A GitHub profile whose email matches an existing row must not attach to that row. The [users and accounts](https://www.better-auth.com/docs/concepts/users-accounts) guide describes linking as enabled by default; this app turns it off.

Scopes are `read:user` only:

- `disableDefaultScope: true`
- `scope: ["read:user"]`

`read:user` is what GitHub documents for the authenticated user endpoint, whose `id` is the integer this allowlist stores ([Get the authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)). The app does not request `user:email`, `repo`, or any other scope.

The [Better Auth GitHub guide](https://www.better-auth.com/docs/authentication/github) tells integrators to include `user:email` so a real address can be stored. This product does not use email as the identity. In the published 1.7.12 GitHub provider, a failed `GET /user/emails` is ignored and sign-in continues. Milestone 2 has to re-check that before upgrading. The provider does not declare an ID-token verifier, so a client-posted `idToken` takes the unsupported branch and does not create a session. Do not add `verifyIdToken`.

Local callback URL, matching `next dev -H 127.0.0.1` and `next start -H 127.0.0.1`:

`http://127.0.0.1:3000/api/auth/callback/github`

`BETTER_AUTH_URL` for local development is `http://127.0.0.1:3000`. The GitHub OAuth app callback must be that exact URL. The browser origin used for sign-in is `http://127.0.0.1:3000` as well.

### Post-login redirects

The sign-in call passes the relative `callbackURL` `/dashboard`. Error redirects use the relative URL `/sign-in`. `/` stays the public scaffold and is not the post-login destination. The route map is in [system design](system.md#routes). 1.7.12's origin middleware, mounted on every auth route, checks `callbackURL` on the sign-in POST and allows a safe relative path. The OAuth `state` value is stored in the `verification` table and echoed in a signed cookie; the callback rejects a state that does not match both. State expires after 10 minutes. The callback then redirects only to the callback URL that was stored with that state.

The authorization request includes a PKCE S256 `code_challenge`. The token request sends the matching `code_verifier`. Callers cannot override `state`, `redirect_uri`, or the PKCE parameters through `additionalParams` in this version.

Server Actions keep Next.js' own check: the action is a POST, and Next.js rejects the request when the `Origin` header does not match the `Host` header ([Data security](https://nextjs.org/docs/app/guides/data-security)). This app does not set `serverActions.allowedOrigins`.

### Identity, email, and the access token

The provider account key is `account.providerId = "github"` and `account.accountId = String(profile.id)`. In 1.7.12, `accountSubject` returns `profile.id` and the account-key helper stores `String(...)`. GitHub's `id` is a JSON integer. For ids inside `Number.MAX_SAFE_INTEGER`, that string is the decimal digits with no leading zeros. The allowlist uses that same string. GitHub user ids in use today are far below that bound; an id that is not a finite safe integer is rejected and creates no session.

`user.id` is Better Auth's own id. Projects belong to `user.id`. They do not belong to the GitHub id.

Better Auth's user schema requires a unique email string, and the 1.7.12 OAuth callback redirects with `email_not_found` before it inserts a user when the profile has no email. GitHub returns `email: null` when the address is private. This app does not ask those users to publish an email.

`mapProfileToUser` therefore sets:

- `email` to `{githubUserId}@users.noreply.devflow.invalid`
- `emailVerified` to false

`.invalid` is a non-routable reserved TLD. The address exists so the library has a unique string. It is not the provider identity, it is not shown as the person's email, and authorization never compares it. The display name stays the library mapping (`profile.name`, otherwise `profile.login`).

The GitHub access token is used in memory to read `/user`, then discarded:

- `account.updateAccountOnSignIn` is false.
- `databaseHooks.account.create.before` and `update.before` return the account payload with `accessToken`, `refreshToken`, `idToken`, and both expiry fields set to null. The [database hooks](https://www.better-auth.com/docs/concepts/database#database-hooks) guide says a returned data object replaces the payload. In 1.7.12 the hook result is merged over the payload, so the returned object includes the rest of the account fields plus those nulls.
- Application logs do not include the token, the authorization code, or the client secret. `getSession` returns the user and the session. Account responses in this version already omit token fields; the client still does not call account-token endpoints.

GitHub OAuth apps do not issue refresh tokens for this flow ([GitHub provider guide](https://www.better-auth.com/docs/authentication/github)). There is nothing to refresh, and this app does not call GitHub again after it has the user id.

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` are server environment variables. The secret is at least 32 random characters. None of them use a `NEXT_PUBLIC_` name. Telemetry stays at the 1.7.12 default, which is off.

## Allowlist

Pilot access is an operator setting, `PILOT_GITHUB_USER_IDS`. It is not an invitations feature and it has no admin UI.

The operator takes the numeric `id` from `GET https://api.github.com/users/{login}` (or from GitHub's durable id endpoint) and stores the decimal digits. Login names are not accepted. A later change adds an empty `PILOT_GITHUB_USER_IDS=` line to `.env.example`. This design does not edit that file.

Parsing happens once, when the config module is first loaded. Production and `next start` keep the result until the process is replaced. Changing the variable requires a restart or redeploy. Request handlers do not re-read it.

Rules, all compared as strings:

| Raw value | Result |
| --- | --- |
| Unset, empty, or whitespace | Empty allowlist. Nobody is approved. |
| Comma-separated canonical ids (`123,456`, spaces around tokens allowed) | Those ids are approved. |
| Any token that is not `^[1-9][0-9]*$`, including an empty token from a trailing comma, a leading zero, a sign, or a decimal | Malformed. Nobody is approved. Valid tokens in the same value do not get partial access. |

The only state that can admit a user is a successful parse with at least one id. Empty and malformed both deny access. The server log says the allowlist is empty or malformed and does not print the raw value. Tests can still tell the two parser results apart.

On every protected page and every protected server operation:

1. Resolve the session with `auth.api.getSession` and the request headers. A missing or expired session is unauthenticated.
2. Load the `account` row for that `user.id` and `providerId = "github"`.
3. Admit the request only when the parsed allowlist is ready and `account.accountId` is a member of that set.

A session cookie, a client-supplied user id, or a previous approval does not skip step 3. An existing session whose GitHub id was removed from the list is unapproved on the next protected call.

There is no separate proxy or middleware authorization gate. The [Next.js integration guide](https://www.better-auth.com/docs/integrations/next) warns that a cookie-presence check is not authentication. This app follows that warning: pages and server operations call `getSession` and the allowlist check themselves. Unauthenticated page visits redirect to `/sign-in`. Unapproved page visits redirect to `/sign-in` with a fixed, safe message. Protected server operations return `unauthenticated` or `unapproved` and do not redirect. Those two results stay distinct.

## Unapproved GitHub users

`user.validateUserInfo` is the admission gate. The library documents it as running before a user is created, and again on a later OAuth sign-in with the fresh provider profile ([Users and accounts](https://www.better-auth.com/docs/concepts/users-accounts)). In the published 1.7.12 OAuth path, the create-user call invokes that gate before the insert. The gate reads `String(source.oauth.profile.id)` for provider `github`. It rejects anything else.

- A GitHub user who has never been approved gets no `user` row, no `account` row, and no session. The browser is sent to the sign-in error URL with a fixed code. The error copy can say this GitHub account is not approved. It does not reveal whether any other account exists.
- A user who was approved, signed in, and was later removed keeps the `user` and `account` rows already stored. That is existing data, not a new provisioning. The sign-in gate refuses a new session. `databaseHooks.session.create.before` also returns false unless the GitHub account id is on the allowlist, so a session insert does not proceed if another code path reaches it. Older session rows are not required to disappear at that moment; the per-request allowlist check rejects them.

`validateUserInfo` in this version fails closed if the callback throws. The gate treats a missing or non-canonical GitHub id as a rejection.

## Tests

The scaffold checks below are what the repository runs today. Every heading marked Planned is required later and is not implemented in this change. This pull request adds no tests, no routes, and no Better Auth install.

### Checks that exist today

CI runs `typecheck`, `lint`, node:test, `next build`, the production smoke request to `/`, and the Compose database smoke. Those commands do not install Better Auth, do not request `/dashboard`, and do not mock GitHub. A docs-only change can re-run the commands that do not need Postgres. It cannot honestly report the Milestone 2 checks below as passed.

### Planned: seeded sessions

Protected-page and authorization tests keep using seeded rows that the real library accepts. They use an isolated database. The test sets its own `DATABASE_URL` to a dedicated database on local Postgres, migrates that database, and refuses to run against an inherited developer URL or the Compose app database `devflow`. The runner stays node:test. CI has no GitHub client credentials and does not call GitHub.

A seeded session is valid only when the library accepts it:

1. Insert `user`, `account` (`providerId` `github`, `accountId` the decimal string), and `session` rows. `session.expiresAt` is in the future. `session.token` is the raw token. Token columns on `account` are null.
2. Sign that token with `makeSignature` from `better-auth/crypto` and the test `BETTER_AUTH_SECRET`, using the 1.7.12 cookie format `${token}.${signature}`.
3. Send the cookie under the configured name (`better-auth.session_token` when the base URL is `http`).
4. Treat the fixture as valid only when `auth.api.getSession` returns that user.

The `testUtils()` plugin is not added to the application auth instance. No production route accepts a user id, a header, or a query parameter in place of a GitHub sign-in. Test helpers live under `tests/` and are not imported by `src/app`. Credentials in these tests are synthetic.

Milestone 2 uses that fixture for `/dashboard` only. `/projects` and `/projects/[projectId]` are not in this milestone.

| Case | Fixture | Expected result on `/dashboard` |
| --- | --- | --- |
| Unauthenticated | No cookie, or a cookie `getSession` rejects | `unauthenticated`. Redirect to `/sign-in`. No protected content. |
| Unapproved | `getSession` succeeds, GitHub account id absent from the allowlist | `unapproved`, distinct from unauthenticated. Redirect to `/sign-in` with the fixed unapproved message. No protected content. |
| Approved | `getSession` succeeds and the GitHub account id is approved | The minimal Milestone 2 page. It does not query dashboard metrics. |
| Empty allowlist | Otherwise valid session, allowlist parsed as empty | `unapproved`. |
| Malformed allowlist | Otherwise valid session, allowlist parsed as malformed | `unapproved`. The well-formed ids in that value do not admit anyone. |

Later milestones reuse the same fixture. Milestone 3 owns admission for `/projects` and `/projects/[projectId]`, project `not_found` behavior, and the project archive policy. Milestone 4 owns task authorization, including task mutations on an archived project. Those cases are in [server operations](server-operations.md#planned-authorization-tests). Browser tests reuse this seeded cookie. They do not log in through live GitHub.

### Planned: offline OAuth through the real handler

Milestone 2 also runs integration tests against the configured Better Auth handler (`toNextJsHandler` / `auth.handler`) and the application hooks. GitHub's token and user HTTP responses are mocked at the network boundary. `user.validateUserInfo`, `databaseHooks.session.create.before`, `mapProfileToUser`, and the account create/update hooks that null token fields stay on the real auth instance. The test does not replace those hooks with stubs that skip admission or token sanitization.

Each case uses synthetic `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `BETTER_AUTH_SECRET`, a synthetic allowlist, and the isolated database. Nothing in the test calls `github.com`.

| Case | Expected result |
| --- | --- |
| (a) Approved first-time sign-in | One `user`, one `account` (`provider_id` `github`, `account_id` the decimal GitHub id), and one `session`. The handler then redirects to `/dashboard`. |
| (b) Approved returning sign-in | The same user and account rows. A new session. The handler redirects to `/dashboard`. |
| (c) Private or null GitHub email | Sign-in succeeds. `user.email` is `{githubUserId}@users.noreply.devflow.invalid` and `email_verified` is false. |
| (d) Unapproved first-time user | The handler creates no `user`, `account`, or `session` row. The browser is sent to `/sign-in` with the fixed not-approved code. |
| (e) Pilot user removed, then configuration reloaded | After a process restart or a fresh load of the config module with that id removed, a new OAuth sign-in creates no session. A session that was valid before the reload is presented again and protected operations return `unapproved`. The test reloads configuration the same way production does. It does not expect an already-loaded process to notice an env change in place. |
| (f) Token columns | After (a), (b), and (c), `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, and `refresh_token_expires_at` are null. |

### Planned: Milestone 2 build and request checks

These run in Milestone 2, which adds Better Auth, `/sign-in`, `/api/auth/[...all]`, and the minimal `/dashboard`. `next.config.ts` keeps `cacheComponents: true` and `partialPrefetching: true`. None of them have been run with Better Auth installed. Milestone 2 does not request `/projects` or `/projects/[projectId]`. Those admission checks are [Milestone 3](server-operations.md#milestone-3-project-routes-and-archive-policy), when the routes exist.

- `next build` with `DATABASE_URL` unset exits 0. `/` still prerenders. The root layout and the `/` page do not import `getAuth()` or `getDb()`.
- `next start` with `DATABASE_URL` unset returns HTTP 200 and the scaffold text for `GET /`. That is the existing production smoke, re-run after the auth route exists. A session cookie on that request still returns the public scaffold. `/` does not redirect to `/dashboard`.
- `GET /sign-in` renders the GitHub sign-in page. It does not require a session and does not render protected content.
- `/api/auth/[...all]` is mounted. The offline OAuth tests in this milestone drive that handler, including the redirect to `/dashboard` after an approved sign-in.
- With the test database migrated, `/dashboard` is checked three ways: no cookie redirects to `/sign-in`; an unapproved seeded session redirects to `/sign-in` with the fixed unapproved message; an approved seeded session returns the minimal page and does not query dashboard metrics. None of those responses render another user's data.
- `/dashboard` and the auth Route Handler read the request, so their responses are not a shared cached render. The build must not open a database connection while prerendering `/`.

In 1.7.12, `getSession` returns before the session query when the session cookie is absent. Constructing `getAuth()` can still touch Postgres if the adapter's schema check runs. Milestone 2 records what an unauthenticated `/dashboard` request does when `DATABASE_URL` is unset. That request must not change the `/` response.

## Sources

- [better-auth 1.7.12 on npm](https://www.npmjs.com/package/better-auth), registry record `https://registry.npmjs.org/better-auth/1.7.12` (published 2026-10-20; peer ranges read 2026-10-23)
- [v1.7.12 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.12) (2026-10-20)
- [Next.js integration](https://www.better-auth.com/docs/integrations/next), including the Next.js 16 section
- [Session management](https://www.better-auth.com/docs/concepts/session-management)
- [Database and hooks](https://www.better-auth.com/docs/concepts/database)
- [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Users and accounts](https://www.better-auth.com/docs/concepts/users-accounts)
- [GitHub provider](https://www.better-auth.com/docs/authentication/github)
- [next-auth 5.0.0-beta.32 release](https://github.com/nextauthjs/next-auth/releases/tag/next-auth%405.0.0-beta.32) (2026-07-20) and registry records for `next-auth@5.0.0-beta.32`, `next-auth@4.24.15`, and `@auth/drizzle-adapter@1.11.3`
- [GitHub REST: get the authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user) (`id` integer, `read:user` for the private user response)
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security) (Server Action origin check)
- This repo: `package.json` and `package-lock.json` (`next@16.4.2`, `react@19.3.0`, `drizzle-orm@^0.45.4`)
