# Private pilot design

Status: design only. Nothing in this directory is implemented.

These documents record the Milestone 1 decisions for the private pilot. They sit on top of the existing Next.js and PostgreSQL scaffold. They do not add dependencies, tables, migrations, routes, or cloud resources.

| Document | What it decides |
| --- | --- |
| [Authentication](authentication.md) | Better Auth 1.7.12, database sessions, GitHub only, allowlist, cookies, seeded sessions, and offline OAuth tests |
| [System](system.md) | One Next.js app, the route map (`/` stays public, sign-in lands on `/dashboard`), screens, and what stays on the scaffold |
| [Database](database.md) | Auth tables, projects, tasks, constraints, and migrations |
| [Server operations](server-operations.md) | Server Actions for product work, the one auth Route Handler, and authorization results |

The running application is still the scaffold described in the [README](../../README.md) and [architecture](../architecture.md). `npm run dev` and `npm run start` keep listening on `127.0.0.1`. Deployment is not approved.
