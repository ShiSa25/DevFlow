import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PILOT_NOT_APPROVED_CODE } from "../../auth/messages";
import { requirePilot } from "../../auth/server";
import { createProjectAction } from "../../projects/actions";
import { projectListHref } from "../../projects/links";
import {
  EMPTY_ACTIVE_MESSAGE,
  EMPTY_ARCHIVED_MESSAGE,
  EMPTY_PAGE_MESSAGE,
  INVALID_FILTERS_MESSAGE,
  PROJECT_PAGE_SIZE,
} from "../../projects/messages";
import { listProjects } from "../../projects/operations";
import type { ProjectView } from "../../projects/types";
import { parseProjectListParams } from "../../projects/validation";
import { PilotNav } from "../pilot-nav";
import { ProjectForm } from "./project-form";

export const metadata = {
  title: "Projects · DevFlow",
};

function ProjectFilters({ view }: { view: ProjectView | null }) {
  return (
    <nav className="filters" aria-label="Project status">
      <Link
        id="project-view-active"
        href={projectListHref("active")}
        aria-current={view === "active" ? "page" : undefined}
      >
        Active
      </Link>
      <Link
        id="project-view-archived"
        href={projectListHref("archived")}
        aria-current={view === "archived" ? "page" : undefined}
      >
        Archived
      </Link>
    </nav>
  );
}

async function ProjectsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status === "unauthenticated") {
    redirect("/sign-in");
  }
  if (admission.status === "unapproved") {
    redirect(`/sign-in?error=${PILOT_NOT_APPROVED_CODE}`);
  }

  const params = await searchParams;
  const parsed = parseProjectListParams(params);
  const listed = parsed.ok ? await listProjects(requestHeaders, params) : null;
  if (listed && !listed.ok && listed.code === "unauthenticated") {
    redirect("/sign-in");
  }
  if (listed && !listed.ok && listed.code === "unapproved") {
    redirect(`/sign-in?error=${PILOT_NOT_APPROVED_CODE}`);
  }

  const view = listed && listed.ok ? listed.view : null;
  const showInvalid = !parsed.ok || (listed !== null && !listed.ok);

  return (
    <main>
      <PilotNav current="projects" />
      <h1>Projects</h1>
      <ProjectFilters view={view} />
      <ProjectForm mode="create" submitAction={createProjectAction} />
      {showInvalid ? (
        <p role="alert">
          {INVALID_FILTERS_MESSAGE} <Link href="/projects">Show active projects</Link>
        </p>
      ) : null}
      {listed && listed.ok ? <ProjectResults listed={listed} /> : null}
    </main>
  );
}

function ProjectResults({
  listed,
}: {
  listed: {
    view: ProjectView;
    page: number;
    total: number;
    projects: { id: string; name: string; updatedAt: string }[];
  };
}) {
  const pageCount = Math.ceil(listed.total / PROJECT_PAGE_SIZE);
  const showPager = listed.page > 1 || pageCount > 1;

  return (
    <>
      {listed.projects.length === 0 ? (
        <p role="status">
          {listed.page > 1
            ? EMPTY_PAGE_MESSAGE
            : listed.view === "archived"
              ? EMPTY_ARCHIVED_MESSAGE
              : EMPTY_ACTIVE_MESSAGE}
        </p>
      ) : (
        <ul className="project-list">
          {listed.projects.map((item) => (
            <li key={item.id}>
              <Link href={`/projects/${item.id}`}>{item.name}</Link>
              <time dateTime={item.updatedAt}>{item.updatedAt}</time>
            </li>
          ))}
        </ul>
      )}
      {showPager ? (
        <nav className="pager" aria-label="Pagination">
          {listed.page > 1 ? (
            <Link href={projectListHref(listed.view, listed.page - 1)}>Previous page</Link>
          ) : (
            <span aria-disabled="true">Previous page</span>
          )}
          <span>Page {listed.page}</span>
          {listed.page < pageCount ? (
            <Link href={projectListHref(listed.view, listed.page + 1)}>Next page</Link>
          ) : (
            <span aria-disabled="true">Next page</span>
          )}
        </nav>
      ) : null}
    </>
  );
}

export default function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <ProjectsContent searchParams={searchParams} />
    </Suspense>
  );
}
