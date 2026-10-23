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

`/` stays static and does not touch the database or the auth instance. Protected UI reads cookies or headers for the current request. It is not wrapped in `"use cache"`, and it is not stored in a cache shared across users.

`getAuth()` and `getDb()` run on first use inside a protected request, not at import time and not from `/`. `next build` and the production smoke check, which unset `DATABASE_URL` and request `/`, stay the scaffold checks. The Milestone 2 build and request checks are listed in [authentication](authentication.md#tests) and are not run by this design change.

## Routes

Successful sign-in lands on `/dashboard`. `/` stays public.

| Path | Admission | What it shows |
| --- | --- | --- |
| `/` | Public. No session check. | Scaffold copy. Does not call `getAuth()` or `getDb()`. Database-independent, including when a session cookie is present. Not the post-login destination. |
| `/sign-in` | Public. No session required to render. | "Continue with GitHub". The sign-in call uses relative `callbackURL` `/dashboard`. Errors use fixed copy and a relative `/sign-in` URL. |
| `/dashboard` | `requirePilot()` before any protected render. | Milestone 2: a minimal page that shows the admitted user is signed in, with no project or task metrics. Milestone 5 adds the dashboard figures below. |
| `/projects` | `requirePilot()` before the list query. | Milestone 3 introduces this route. One project list. The active/archived filter is in the URL. Default is active. |
| `/projects/[projectId]` | `requirePilot()`, then an owner-scoped project query. | Milestone 3 introduces this route. That project, or the shared not-found page. Task operations on it are Milestone 4. |
| `/api/auth/[...all]` | Better Auth's handler. | OAuth callback and session HTTP. Not a product API. |

`/dashboard`, `/projects`, and `/projects/[projectId]` are the protected pages. Each calls `requirePilot()` in the page or in a layout that wraps only those routes. Unauthenticated visitors redirect to `/sign-in`. Unapproved visitors redirect to `/sign-in` with the fixed unapproved message. The root layout does not perform this check, so `/` and `/sign-in` stay free of it. Every Server Action those pages call runs `requirePilot()` again.

Milestone 2 adds `/sign-in`, the auth handler, the auth tables, and the minimal `/dashboard`, and it checks admission only on `/dashboard`. It does not implement dashboard metrics, `/projects`, or `/projects/[projectId]`. Milestone 3 adds those project routes and their admission checks. Milestone 4 adds tasks on the project page. Milestone 5 adds the dashboard metrics.

## Screens

The pilot UI is server-rendered, works on a narrow viewport and a desktop viewport, and uses semantic HTML.

| Screen | Behavior |
| --- | --- |
| Sign-in, `/sign-in` | One control, "Continue with GitHub". Success goes to `/dashboard`. Known OAuth failures use fixed copy: cancellation, not approved, and a generic failure. Query text from GitHub is not inserted as HTML. |
| Dashboard, `/dashboard` | Milestone 2 shows only that an admitted user reached a protected page. Milestone 5 adds active projects, open tasks, all-time completed tasks in active projects, overdue tasks, and up to five recent active projects. The recent heading is **Recently edited projects.** Empty accounts get a create-project call to action. Accounts with only archived projects also get a link to the archived filter. A short note states the `APP_TIME_ZONE` used for due dates. |
| Project list, `/projects` | Milestone 3. One list. A control switches `active` and `archived`. The default is active. The choice is in the URL. |
| Project detail, `/projects/[projectId]` | Milestone 3 opens the project. Milestone 4 adds its tasks. Filter, search, sort, and page live in the URL. An archived project and its tasks stay readable. Restore and permanent delete remain available. Creating, updating, or deleting a task, and editing the project fields, are refused while it is archived. |
| Forms | Create and edit project, create and edit task. A separate task page is unnecessary. |

Destructive confirmation uses the native `<dialog>` element opened with `showModal()`. Milestone 3's dialog says that deleting the project is permanent. It does not say that tasks will be deleted, because the task table does not exist yet. When tasks exist, the dialog also says that the project's tasks will be deleted. The dialog has an accessible name, opens and closes from the keyboard through the native dialog, and returns focus to the control that opened it. Validation errors are tied to their fields and announced. Buttons show a visible focus style. A pending mutation disables the submitting control so the action is not sent twice.

No component library is planned. Add a primitive later only when a native element cannot meet one of those behaviors.

Task edits do not change the project's "recently edited" time. Archive and restore do, because they change the project. Archived projects are excluded from the dashboard and from the recent list, so an archive drops the project out of that list. Restoring it can bring it back.

## Time and configuration

`APP_TIME_ZONE` is an IANA name. Unset means `UTC`. A value that is not a valid IANA zone fails closed when due dates or the dashboard are evaluated: the operation returns an error and does not compare dates in the host's local zone. Event timestamps are stored in UTC. Due dates are calendar dates. "Today" is the calendar date in `APP_TIME_ZONE`. A task due on that date is not overdue.

The allowlist and the auth secret are described in [authentication](authentication.md). The public home page still renders when they are absent. Protected operations deny access when the allowlist is empty or malformed.

## Later milestones

Milestone 2 implements GitHub sign-in, sessions, the allowlist, the auth tables, `/sign-in`, the auth handler, and a minimal protected `/dashboard`. Its checks are the build, request, `/dashboard` session, and offline OAuth checks in [authentication](authentication.md#tests). It does not request `/projects` or `/projects/[projectId]`, and it does not compute dashboard metrics.

Milestone 3 adds the project routes and project operations, including their admission checks and the project archive policy in [server operations](server-operations.md#milestone-3-project-routes-and-archive-policy). Milestone 4 adds task operations, including archived-project task rules, in [server operations](server-operations.md#milestone-4-task-authorization). Milestone 5 adds `getDashboard`. Each feature's tests arrive in that feature's change. Milestone 2 added the authentication CI step. Milestone 3 adds `scripts/project-checks.sh` the same way. The workflow still does not migrate on startup or deploy the app.

Deployment, including any hosting bind address other than `127.0.0.1`, waits for a separate approval. This design does not add a container manifest or Terraform.
