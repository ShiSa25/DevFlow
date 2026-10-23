# DevFlow

A developer productivity dashboard. The app is a Next.js App Router project with TypeScript, PostgreSQL, GitHub sign-in for approved pilots, and owner-scoped projects. Tasks and dashboard metrics are not implemented yet. See [docs/architecture.md](docs/architecture.md) for the layout, the database pool, and the work that is still ahead.

The private-pilot design is in [docs/design](docs/design/README.md).

## Requirements

- Node.js 22 LTS
- npm
- Docker, when you want a local Postgres

## Run the app

The app boots when Postgres is stopped and when `DATABASE_URL` is unset. The home page at `/` is static scaffold copy. It does not check database readiness and it does not sign anyone in. GitHub sign-in, sessions, and the minimal dashboard are separate routes and need the database.

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm run start
```

`dev` and `start` listen on `127.0.0.1`. Open http://127.0.0.1:3000.

## Local Postgres

```bash
docker compose up -d
cp .env.example .env
npm run db:migrate
```

Compose starts PostgreSQL 18 with user, password, and database `devflow`, published on `127.0.0.1:5432`. The named volume is mounted at `/var/lib/postgresql`, which is where the PostgreSQL 18 image keeps its data. `DATABASE_URL` in `.env.example` matches that database.

Schema changes:

```bash
npm run db:generate
npm run db:migrate
```

`db:generate` writes SQL from `src/db/schema.ts` and does not need a running database. `db:migrate` applies `drizzle/` and does need one. App startup does not migrate.

`npm run db:smoke` loads `.env` when `DATABASE_URL` is not already exported, runs `SELECT 1` through the application database client, and closes that pool. An exported `DATABASE_URL` stays in effect. Use it after Postgres is healthy and migrations have been applied. `scripts/database-smoke.sh` is separate: it always sets `DATABASE_URL` to the Compose database before migrating and querying, and it does not keep an inherited URL.

## GitHub sign-in

DevFlow signs pilots in with one GitHub OAuth App. The app requests only the `read:user` scope. It does not ask for repository access or a public email address. The GitHub user id, not the email, is the identity.

Create an OAuth App at [GitHub Developer Settings](https://github.com/settings/developers):

1. Homepage URL: `http://127.0.0.1:3000`
2. Authorization callback URL: `http://127.0.0.1:3000/api/auth/callback/github`

Put the client id and client secret in `.env`. Generate `BETTER_AUTH_SECRET` with at least 32 random characters (`openssl rand -base64 32`). `BETTER_AUTH_URL` for this local process is `http://127.0.0.1:3000`. Use that host in the browser too. `localhost` and `127.0.0.1` are different origins for the OAuth callback.

Find a person's numeric GitHub id from `GET https://api.github.com/users/{login}` and copy the integer `id`. Put the decimal digits in `PILOT_GITHUB_USER_IDS`, separated by commas when there is more than one. Login names are not accepted. An empty, missing, or malformed value denies every account, including ids that would otherwise have been valid.

`PILOT_GITHUB_USER_IDS` is read when the server process loads it. Changing the variable does nothing to a process that is already running. Restart `npm run dev` or `npm run start`, or redeploy, before the new list is used.

```bash
docker compose up -d
cp .env.example .env
# fill in the GitHub OAuth values, the auth secret, and the allowlist
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:3000/sign-in and use Continue with GitHub. The button stays disabled while the browser is sent to GitHub, so the click is not sent twice. If that request fails, the button is enabled again and the page shows "GitHub sign-in did not complete. Try again." It does not show the server's error body. An approved sign-in lands on `/dashboard`, which shows that the person is signed in and links to Projects. It does not show project or task metrics. Sign out from that page. `/` stays the public scaffold page.

The auth handler exposes GitHub sign-in, the GitHub callback, session reads, and sign-out. Profile updates, email or password changes, account deletion, and the other Better Auth account routes are disabled. A session that was valid before someone was removed from `PILOT_GITHUB_USER_IDS` can still be read and signed out, and it cannot change the stored profile. Protected pages use a separate check and send that person back to sign-in.

Do not set `BETTER_AUTH_TRUSTED_ORIGINS`. The app rejects that variable so extra origins cannot be added to the library's trusted list.

The database module keeps one pool per process. Development stores that pool on `globalThis` so Next.js hot reload reuses it. Idle pool errors are logged with database URLs redacted. Importing the module does not connect.

## Projects

An approved pilot can create, list, view, edit, archive, restore, and permanently delete their own projects at `/projects` and `/projects/[projectId]`. There is no task list, no shared project, and no GitHub repository import.

The list is one query. Active projects are the default. `view=archived` shows archived projects. The page size is 25, ordered by `updated_at` descending and then `id` descending. Changing the filter returns to page 1. A page past the end is empty. Archived projects stay readable. Restore and permanent delete remain available. Editing an archived project is rejected and does not write. Repeating archive or restore succeeds and does not change timestamps.

Permanent delete uses a native dialog that says the deletion cannot be undone. The server action accepts the delete only when `confirm` is `delete`. The project table does not reference a task table, so this delete does not cascade to tasks.

`npm run test:projects` follows the same isolation rules as `npm run test:auth`. It needs the local Compose Postgres and a completed `npm run build` for the route checks. It creates a database named `devflow_project_test_` plus random hex, migrates only that database, and drops it afterward. It does not migrate `devflow` or an inherited `DATABASE_URL`.

## Checks

```bash
npm run typecheck
npm run lint
npm run test
```

`npm run test:auth` and `npm run test:projects` are separate from `npm run test`. Both need the local Compose Postgres. `test:auth` also needs a completed `npm run build`, and so do the project route checks. `test:auth` creates a database named `devflow_auth_test_` plus random hex, migrates only that database, and drops it afterward. It does not migrate `devflow` or an inherited `DATABASE_URL`. The GitHub token and user endpoints are mocked. CI does not call GitHub.

`typecheck` and `lint` generate Next.js route types first, then run `tsc --noEmit` or ESLint.

CI (`.github/workflows/ci.yml`) runs those checks on Node.js 22 for pull requests and pushes to `main`, then builds and runs two smoke checks:

```bash
npm run build
bash scripts/production-smoke.sh
bash scripts/database-smoke.sh
```

The production script expects a completed build, unsets `DATABASE_URL`, and requests the scaffold page on `127.0.0.1:3000`. The authentication script starts Compose Postgres, then runs `npm run test:auth` with any inherited `DATABASE_URL` removed. The project script does the same for `npm run test:projects`. Those tests create and migrate an isolated database. The database script starts the Compose Postgres, waits up to 60 seconds for it to become healthy, sets `DATABASE_URL` to the Compose database, migrates, and runs `SELECT 1`. It does not send those commands to an inherited database URL.
