# Server operations

Product behavior is Server Actions and server-side queries. The only Route Handler added for this pilot is Better Auth's catch-all at `src/app/api/auth/[...all]`, mounted with `toNextJsHandler` ([Next.js integration](https://www.better-auth.com/docs/integrations/next)). GitHub redirects the browser to that callback. Projects and tasks are not resources on that handler, and there is no second HTTP service.

A page-level redirect is not the authorization check. Next.js documents that an exported Server Action remains callable as a POST by itself ([Data security](https://nextjs.org/docs/app/guides/data-security)). Every protected operation below starts with the same helper.

## Admission

`requirePilot()`:

1. `auth.api.getSession({ headers })`. No session, or a session the library rejects as expired, yields `unauthenticated`.
2. Load `account` where `user_id` is the session user and `provider_id` is `github`.
3. If the loaded allowlist is empty or malformed, or `account_id` is not in the ready set, yield `unapproved`.

The protected pages are `/dashboard`, `/projects`, and `/projects/[projectId]`, as mapped in [system design](system.md#routes). Those pages call `requirePilot()` and redirect. `/` and `/sign-in` do not call it. Server Actions call `requirePilot()` and return the code. They do not redirect. The current user always comes from the session. The client never sends an owner id that the server trusts.

`unauthenticated` and `unapproved` stay different results so tests can tell a missing session from a session that is no longer on the pilot list.

## Not found

For a record id that does not exist, and for a record the caller does not own, the operation returns one result: `not_found`. The page renders the framework not-found UI. The action returns `{ ok: false, code: "not_found" }`.

The query includes the owner, so the two situations are the same query result:

- Project: `id` and `owner_id` match the caller.
- Task: `task.id`, `task.project_id`, and the project's `owner_id` all match the caller and the supplied project id.

A task id that belongs to a different project, including another project the same user owns when the action was given a mismatched pair, is `not_found`. The operation does not write.

A malformed UUID in a page URL is the same not-found page. A malformed UUID in an action is an `invalid` validation result. That result does not say whether any row exists.

An archived project the caller owns stays viewable, including its tasks. While it is archived, the only mutations that write are `restoreProject` and `deleteProject`. `archiveProject` on an already archived owned project does not write. `updateProject`, `createTask`, `updateTask`, and `deleteTask` return `archived` and do not write. A missing project, a project the caller does not own, or a task/project pair that does not match returns `not_found` whether or not that project is archived. `not_found` and `archived` stay different results.

## Validation

Zod parses every action input and every search-param object before a query runs. Rules:

| Field | Rule |
| --- | --- |
| Project name | Trim. Length 1–100. |
| Task title | Trim. Length 1–200. |
| Description | Trim. Empty becomes null. At most 5,000 characters. Plain text. |
| Status | One of `backlog`, `todo`, `in_progress`, `done`. Default `todo`. Any status may move to any other, including reopening `done`. |
| Priority | One of `low`, `medium`, `high`, `critical`. Default `medium`. |
| Due date | A real calendar `YYYY-MM-DD`, or null. Past dates are allowed. |
| Search | Trim. At most 200 characters. Treated as literal text. `%`, `_`, and `\` are escaped before `ILIKE`. |
| Page | Integer ≥ 1. Default 1. Page size is 25. |
| Project view | `active` or `archived`. Default `active`. |
| Task sort | `created_desc` (default), `created_asc`, `due_asc`, `priority_desc`. |

Invalid input returns `invalid` and does not write. A rejected mutation leaves stored data as it was.

Search, status, and priority filters combine with AND. Pagination applies after those filters and after the owner predicate. A page past the end returns an empty page. Changing a filter or the sort is a URL change that sets the page back to 1.

Sorts:

- `created_desc` / `created_asc`: `created_at`, then `id` in the same direction.
- `due_asc`: `due_on` ascending with nulls last, then `id` ascending.
- `priority_desc`: `critical`, `high`, `medium`, `low`, then `id` ascending.

Project lists order by `updated_at` descending, then `id` descending.

## Operations

Each function lives next to its domain (`src/projects`, `src/tasks`) and calls `getDb()`. There is no generic repository.

| Operation | Writes | Notes |
| --- | --- | --- |
| `listProjects` | No | One list. `view=active` requires `archived_at` null. `view=archived` requires it set. Page size 25. |
| `createProject` | Yes | Active. Trimmed name and normalized description. Sets `updated_at`. |
| `updateProject` | Yes | Owned and active. Name and description only. Sets `updated_at`. Archived owned projects return `archived`. |
| `archiveProject` | Yes | Sets `archived_at` and `updated_at` on an owned active project. Archiving an already archived owned project is a no-op success. |
| `restoreProject` | Yes | Clears `archived_at` and sets `updated_at`. Restoring an active owned project is a no-op success. |
| `deleteProject` | Yes | Owned project, active or archived. Input includes `confirm: "delete"` so a stray submit does not delete. The database `ON DELETE CASCADE` removes tasks. The dialog states that. |
| `listTasks` | No | One project, owned. Filters, literal search, sort, page size 25. Allowed on an archived project. |
| `createTask` | Yes | Owned active project. An owned archived project returns `archived` and does not insert. Does not change `project.updated_at`. |
| `updateTask` | Yes | Owned task in the named active project. An owned archived project returns `archived` and does not update. Does not change `project.updated_at`. |
| `deleteTask` | Yes | Owned task in the named active project. Confirmation is required in the input. An owned archived project returns `archived` and does not delete the task. A missing or inaccessible project, task, or pair returns `not_found`. Does not change `project.updated_at`. |
| `getDashboard` | No | Counts and the recent list, from this user's rows only. This is the later dashboard milestone. Milestone 2's `/dashboard` page does not call it. |

Dashboard numbers:

| Figure | Definition |
| --- | --- |
| Active projects | `archived_at` is null. |
| Open tasks | Status `backlog`, `todo`, or `in_progress`, in active projects. |
| Completed tasks | Status `done` in active projects. All-time, not a weekly count. The UI says so. |
| Overdue tasks | Open tasks in active projects whose `due_on` is earlier than today in `APP_TIME_ZONE`. |
| Recently edited projects | Five active projects, `updated_at` descending, `id` descending. Label: **Recently edited projects.** |

Archived projects and their tasks are outside every dashboard figure. Restoring a project brings its tasks back into those figures. Tasks with no due date are never overdue.

An account with no projects gets a create-project prompt. An account whose projects are all archived gets that prompt and a link to `view=archived` on the same project list.

## Errors the UI shows

| Code | When | UI |
| --- | --- | --- |
| `unauthenticated` | No usable session | Page redirects to `/sign-in`. Action returns the code. |
| `unapproved` | Session exists, GitHub id is not approved, or the allowlist is empty or malformed | Page redirects to sign-in with fixed copy. Action returns the code. |
| `not_found` | Missing id, other owner's id, or a task/project pair that does not match | Same not-found presentation in every case. |
| `archived` | Owner tried to edit project fields, or create, update, or delete a task, while that owned project is archived | No write. Restore and permanent project delete remain available. View stays available. |
| `invalid` | Zod rejected the input | Field errors, announced, data unchanged. |
| Success | Write committed | The page shows the new data. |

OAuth cancellation and failure messages are listed in [authentication](authentication.md). They are fixed strings for known codes.

Pending mutations disable the control that submitted them. Focus returns to the opener when a native dialog closes. Those checks are part of building the UI, not part of this pull request.

## Planned authorization tests

These are not implemented in this change. They use the seeded sessions in [authentication](authentication.md#tests). Archived cases:

- The owner can read an archived project and its tasks.
- `restoreProject` writes for that owner. `deleteProject` writes and the task rows go away with the project cascade.
- `updateProject`, `createTask`, `updateTask`, and `deleteTask` return `archived` and leave the project and task rows unchanged.
- The same reads and mutations against another user's archived project, or against an id that does not exist, return `not_found` and do not write.
