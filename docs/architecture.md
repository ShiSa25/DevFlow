# Architecture

DevFlow is a Next.js App Router application. This repository is the scaffold: a layout, PostgreSQL wiring, and checks. Product behavior is not implemented yet.

## Layout

| Path | Role |
| --- | --- |
| `src/app` | HTTP entry. Routes, layouts, and the home page. |
| `src/config` | Process configuration read from the environment. |
| `src/db` | Data access. `schema.ts` is the Drizzle schema. `client.ts` is the only module that constructs a Postgres pool. |
| `src/health` | Process-local health snapshot used by the home page. |
| `tests` | Automated checks, run with node:test through `tsx`. They import application modules directly. |
| `drizzle` | SQL migrations produced by Drizzle Kit. `meta/_journal.json` starts with an empty entry list. |
| `docs` | Repository documentation. |

Routes stay in `src/app`. Configuration stays in `src/config`. Anything that talks to Postgres goes through `src/db`, so a route cannot open its own connection by accident as the app grows.

## Request flow

1. Next.js receives the request and renders the matching route in `src/app`.
2. The home page calls `getHealthSnapshot()`.
3. That function returns a fixed snapshot. It does not read `DATABASE_URL` and it does not import the database client.
4. A later route that needs stored data calls a function in `src/db`. That function calls `getDb()` and runs a query. Route files do not import `pg` or construct a pool.

The home page is a static shell. With Cache Components enabled, Next.js can prerender it during `next build`. The prerender does not need Postgres, because the page never asks for it.

## Data access flow

1. Application code calls `getDb()`.
2. `getDb()` reads `DATABASE_URL` through `src/config/env.ts`.
3. When the variable is missing, `getDb()` throws `DATABASE_URL is not set` before it creates a pool.
4. The first successful call creates one `pg` `Pool` and one Drizzle client. The pool connects when a query runs, not when `src/db/client.ts` is imported and not when the Next.js process boots.
5. Schema changes are made in `src/db/schema.ts`. `npm run db:generate` writes SQL into `drizzle/`. `npm run db:migrate` applies those files. Starting the app does not run migrations.

`pg` is listed in `serverExternalPackages` so the Next.js bundler loads the driver from `node_modules` when a server module imports it.

Drizzle Kit is the schema tool. The runtime client is Drizzle ORM on node-postgres (`pg`). The schema stays in TypeScript next to the client, and Kit turns that schema into SQL migrations.

`drizzle.config.ts` uses `DATABASE_URL` when it is set. Otherwise it uses the same local URL as `.env.example` and `docker-compose.yml`.

## Boot while Postgres is down

`npm run dev` and `npm run build && npm run start` bring the app up in any of these situations:

- `DATABASE_URL` is unset
- `DATABASE_URL` is set and Postgres is not running
- Docker Compose has not been started

The process listens, and the home page reports status `ok` and database `not contacted`. A later request that calls `getDb()` and then runs a query fails on that request until Postgres is reachable. The failure stays on that request. Module import and process startup do not open a socket.

`npm run db:migrate` is the command that requires a running database. It is not part of boot.

## Local Postgres

`docker-compose.yml` starts PostgreSQL 18, the current stable major (PostgreSQL 19 is still a release candidate). The database name, user, and password are `devflow`. Compose publishes Postgres on `127.0.0.1:5432` only.

```bash
docker compose up -d
cp .env.example .env
npm run db:migrate
```

## Intentionally deferred

These are product and platform pieces this scaffold does not include:

- Authentication and sessions
- Dashboard and other product screens
- Token or usage tracking
- Domain tables and queries
- Background workers, queues, and email
- Hosted deployment manifests

Add a table to `src/db/schema.ts`, generate a migration, and call `getDb()` from the route that needs the data when the first product feature needs storage.
