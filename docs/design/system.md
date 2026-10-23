# System design

DevFlow's private pilot is one Next.js App Router process and one PostgreSQL database. Each approved person signs in with GitHub, owns projects, and manages the tasks inside those projects. There is no team, no shared project, and no GitHub issue or pull-request import.

The scaffold stays in place: Next.js 16.4.2, React 19.3.0, TypeScript strict mode, Node.js 22, Drizzle ORM on `pg`, node:test through `tsx`, and the current GitHub Actions checks. This design adds no package, no migration, and no Terraform. Deployment is not approved. `dev` and `start` keep binding `127.0.0.1`.

## Modules

| Path | Role |
| --- | --- |
| `src/app` | Routes, layouts, and the auth catch-all. Route files do not import `pg` or construct a pool. |
| `src/auth/server.ts` | Lazy `getAuth()`, session lookup, allowlist admission. Server-only. |
| `src/auth/client.ts` | Browser client from `better-auth/react`. It talks to `/api/auth/*` and does not import the server module or `src/db`. |
| `src/config` | Environment parsing, including the pilot allowlist and `APP_TIME_ZONE`. |
| `src/db` | Drizzle schema and the existing lazy pool. `getDb()` remains the only pool constructor. |
| `src/projects`, `src/tasks` | Input validation and owner-scoped operations. Plain functions. No repository framework and no second service. |
| `tests` | node:test, including the isolated-database session fixtures described in [authentication](authentication.md). |
| `drizzle` | SQL from `drizzle-kit`. App startup does not migrate. |

Zod validates input at the server boundary. The direct dependency added with the feature work should be Zod 4, because Better Auth 1.7.12 already depends on Zod 4. This pull request does not add it.

Prisma and Vitest are not introduced. Tailwind is the styling approach when UI work starts. It is not added in this pull request. The current `globals.css` stays as it is.

## Request paths

Three entry points exist. There is no product REST API and no separate backend.

1. **Pages and layouts** in `src/app` render the current user's data. A protected page calls the admission helper. Unauthenticated visitors redirect to `/sign-in`. Unapproved visitors redirect to `/sign-in` with a fixed message. Missing and inaccessible records both render the not-found page.
2. **Server Actions** perform product reads that the page does not already have, and every mutation. Each action admits the caller, validates input, then runs an owner-scoped query. A failed admission returns `unauthenticated` or `unapproved`. It does not redirect. Next.js treats a Server Action as reachable by POST even when the page is hidden, so the action repeats the check the page already did ([Data security](https://nextjs.org/docs/app/guides/data-security)).
3. **One Route Handler**, `src/app/api/auth/[...all]/route.ts`, mounts Better Auth with `toNextJsHandler`. GitHub's browser redirect needs a real HTTP callback. That handler is the library's OAuth and session surface. Project and task operations are not routes under it.

The public scaffold page stays static and does not touch the database or the auth instance. Protected UI reads cookies or headers for the current request. It is not wrapped in `"use cache"`, and it is not stored in a cache shared across users.

`getAuth()` and `getDb()` run on first use inside a request, not at import time. `next build` and the production smoke check, which unset `DATABASE_URL` and request `/`, keep working without Postgres and without GitHub credentials.

## Screens

The pilot UI is server-rendered, works on a narrow viewport and a desktop viewport, and uses semantic HTML.

| Screen | Behavior |
| --- | --- |
| Sign-in | One control, "Continue with GitHub". Relative callback `/`. Known OAuth failures use fixed copy: cancellation, not approved, and a generic failure. Query text from GitHub is not inserted as HTML. |
| Dashboard | Active projects, open tasks, all-time completed tasks in active projects, overdue tasks, and up to five recent active projects. The recent heading is **Recently edited projects.** Empty accounts get a create-project call to action. Accounts with only archived projects also get a link to the archived filter. A short note states the `APP_TIME_ZONE` used for due dates. |
| Project list | One list. A control switches `active` and `archived`. The default is active. The choice is in the URL. |
| Project detail | Tasks for that project. Filter, search, sort, and page live in the URL. Archived projects stay readable. Their edit controls are unavailable. Permanent delete remains available. |
| Forms | Create and edit project, create and edit task. A separate task page is unnecessary. |

Destructive confirmation uses the native `<dialog>` element opened with `showModal()`. The project-delete dialog says that the project's tasks will also be deleted. When that UI is built, the dialog needs an accessible name, it must open and close from the keyboard, and focus must return to the control that opened it. Validation errors are tied to their fields and announced. Buttons show a visible focus style. A pending mutation disables the submitting control so the action is not sent twice.

No component library is planned. Add a primitive later only when a native element cannot meet one of those behaviors.

Task edits do not change the project's "recently edited" time. Archive and restore do, because they change the project. Archived projects are excluded from the dashboard and from the recent list, so an archive drops the project out of that list. Restoring it can bring it back.

## Time and configuration

`APP_TIME_ZONE` is an IANA name. Unset means `UTC`. A value that is not a valid IANA zone fails closed when due dates or the dashboard are evaluated: the operation returns an error and does not compare dates in the host's local zone. Event timestamps are stored in UTC. Due dates are calendar dates. "Today" is the calendar date in `APP_TIME_ZONE`. A task due on that date is not overdue.

The allowlist and the auth secret are described in [authentication](authentication.md). The public home page still renders when they are absent. Protected operations deny access when the allowlist is empty or malformed.

## Later milestones

Milestone 2 implements GitHub sign-in, sessions, the allowlist, and the auth tables, and it proves approved, unapproved, and cross-user behavior before product mutations exist.

Milestones 3 through 5 add projects, tasks, and the dashboard, with tests in the same change as each feature. CI gains those tests when the feature arrives. This design does not change `.github/workflows/ci.yml`.

Deployment, including any hosting bind address other than `127.0.0.1`, waits for a separate approval. This design does not add a container manifest or Terraform.
