# DevFlow

A developer productivity dashboard. This repository currently contains the application scaffold: Next.js App Router, TypeScript, and PostgreSQL. See [docs/architecture.md](docs/architecture.md) for the layout, the database pool, and the product work that is still ahead.

## Requirements

- Node.js 22 LTS
- npm
- Docker, when you want a local Postgres

## Run the app

The app boots when Postgres is stopped and when `DATABASE_URL` is unset. The home page is static scaffold copy. It does not check database readiness.

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

The database module keeps one pool per process. Development stores that pool on `globalThis` so Next.js hot reload reuses it. Idle pool errors are logged with database URLs redacted. Importing the module does not connect.

## Checks

```bash
npm run typecheck
npm run lint
npm run test
```

`typecheck` and `lint` generate Next.js route types first, then run `tsc --noEmit` or ESLint.

CI (`.github/workflows/ci.yml`) runs those checks on Node.js 22 for pull requests and pushes to `main`, then builds and runs two smoke checks:

```bash
npm run build
bash scripts/production-smoke.sh
bash scripts/database-smoke.sh
```

The production script expects a completed build, unsets `DATABASE_URL`, and requests the scaffold page on `127.0.0.1:3000`. The database script starts the Compose Postgres, waits up to 60 seconds for it to become healthy, sets `DATABASE_URL` to `postgres://devflow:devflow@localhost:5432/devflow`, migrates, and runs `SELECT 1`. It does not send those commands to an inherited database URL.
