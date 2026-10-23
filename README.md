# DevFlow

A developer productivity dashboard. This repository currently contains the application scaffold: Next.js App Router, TypeScript, and PostgreSQL. See [docs/architecture.md](docs/architecture.md) for the layout and for the product work that is still ahead.

## Requirements

- Node.js 20.9 or newer
- npm
- Docker, when you want a local Postgres

## Run the app

The app boots when Postgres is stopped and when `DATABASE_URL` is unset. The home page does not contact the database.

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
npm run start
```

Open http://localhost:3000.

## Local Postgres

```bash
docker compose up -d
cp .env.example .env
npm run db:migrate
```

Compose starts PostgreSQL 18 with user, password, and database `devflow` on port `5432`. That matches `DATABASE_URL` in `.env.example`.

Schema changes:

```bash
npm run db:generate
npm run db:migrate
```

`db:generate` writes SQL from `src/db/schema.ts` and does not need a running database. `db:migrate` applies `drizzle/` and does need one. App startup does not migrate.

## Checks

```bash
npm run typecheck
npm run lint
npm run test
```

`typecheck` and `lint` generate Next.js route types first, then run `tsc --noEmit` or ESLint.
