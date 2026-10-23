# Architecture

DevFlow is a Next.js App Router application. This repository is the scaffold: a layout, PostgreSQL wiring, and checks. Product behavior is not implemented yet.

## Layout

| Path | Role |
| --- | --- |
| `src/app` | HTTP entry. Routes, layouts, and the static home page. |
| `src/config` | Process configuration read from the environment. |
| `src/db` | Server-only data access. `schema.ts` is the Drizzle schema. `client.ts` is the only module that constructs a Postgres pool. |
| `tests` | Automated checks, run with node:test through `tsx`. They import application modules directly. |
| `drizzle` | SQL migrations produced by Drizzle Kit. `meta/_journal.json` starts with an empty entry list. |
| `scripts` | Production and database smoke checks used locally and in CI. |
| `docs` | Repository documentation. |
| `.github/workflows/ci.yml` | Pull request and `main` checks. |

Routes stay in `src/app`. Configuration stays in `src/config`. Server code that talks to Postgres calls `getDb()` in `src/db`. Route files do not import `pg` or construct a pool. Do not import `src/db` from a client component.

## Request flow

1. Next.js receives the request and renders the matching route in `src/app`.
2. The home page is static scaffold copy. It does not read `DATABASE_URL`, import `src/db`, or check whether Postgres is up. It is not a database readiness check.
3. With Cache Components enabled, `next build` prerenders that page. The prerender does not need Postgres.
4. A later server route that needs stored data calls `getDb()` and runs a query.

`npm run dev` and `npm run start` listen on `127.0.0.1`. `poweredByHeader` is off, so responses do not include `X-Powered-By`.

## Data access

1. Application code calls `getDb()`.
2. `getDb()` reads `DATABASE_URL` through `src/config/env.ts`.
3. When the variable is missing or blank, `getDb()` throws `DATABASE_URL is not set` before it creates a pool.
4. The first successful call creates one `pg` `Pool` and one Drizzle client. Later calls in that process reuse them, including when a later call passes a different URL. The pool connects when a query runs, not when `src/db/client.ts` is imported and not when the Next.js process boots.
5. In development, the pool is stored on `globalThis.__devflowPgPool`. Next.js hot reload evaluates the module again, and the new evaluation reuses that pool instead of opening another one. In any other `NODE_ENV`, the pool lives in the module. A process holds one pool for the mode it is running in.
6. The pool registers an `error` listener immediately. Idle connection errors are logged as `PostgreSQL pool error:` plus the error code and message. Database URLs in that message are replaced with `[redacted]`. The listener does not log the connection string or the pool configuration.
7. Schema changes are made in `src/db/schema.ts`. `npm run db:generate` writes SQL into `drizzle/` and does not need a running database. `npm run db:migrate` applies those files. Starting the app does not run migrations.

`pg` is listed in `serverExternalPackages` so the Next.js bundler loads the driver from `node_modules` when a server module imports it.

Drizzle Kit is the schema tool. The runtime client is Drizzle ORM on node-postgres (`pg`). The schema stays in TypeScript next to the client, and Kit turns that schema into SQL migrations.

`drizzle.config.ts` uses `DATABASE_URL` when it is set. Otherwise it uses the same local URL as `.env.example`.

## Boot while Postgres is down

`npm run dev` and `npm run build && npm run start` bring the app up when `DATABASE_URL` is unset, when it points at a stopped database, or when Compose has not been started. The home page renders the scaffold text. A later request that calls `getDb()` and runs a query fails on that request until Postgres is reachable. Module import and process startup do not open a socket.

`npm run db:migrate` and `npm run db:smoke` are the commands that use a running database.

## Local Postgres

`docker-compose.yml` starts PostgreSQL 18. The image stores data under `/var/lib/postgresql/18/docker` and declares its volume at `/var/lib/postgresql`, so Compose mounts the named volume `devflow-postgres` there. The database name, user, and password are `devflow`. Compose publishes Postgres on `127.0.0.1:5432` only.

```bash
docker compose up -d
cp .env.example .env
npm run db:migrate
```

`npm run db:smoke` runs `SELECT 1` through `getDb()` and then closes that pool.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It uses Node.js 22, the supported LTS for this repository. The job runs `npm ci`, typecheck, lint, tests, and a production build with no `DATABASE_URL`.

The production smoke check starts `npm run start` with `DATABASE_URL` unset and without Postgres. It requires HTTP 200 from `http://127.0.0.1:3000/` and the scaffold page text.

The database smoke check runs `docker compose up -d --wait --wait-timeout 60` against this Compose file, applies migrations, and runs `npm run db:smoke`. If Postgres does not become healthy within 60 seconds, or either later command fails, the job exits with a smoke-check message and Compose logs. The script always runs `docker compose down --remove-orphans` afterward. That stops the container and does not delete the named volume.

## Intentionally deferred

These are product and platform pieces this scaffold does not include:

- Authentication and sessions
- Dashboard and other product screens
- Token or usage tracking
- Domain tables and queries
- Background workers, queues, and email
- A container for the Next.js app
- Hosted deployment manifests

Add a table to `src/db/schema.ts`, generate a migration, and call `getDb()` from the server route that needs the data when the first product feature needs storage.
