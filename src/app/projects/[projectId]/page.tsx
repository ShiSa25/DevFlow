import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PILOT_NOT_APPROVED_CODE } from "../../../auth/messages";
import { requirePilot } from "../../../auth/server";
import {
  archiveProjectAction,
  deleteProjectAction,
  restoreProjectAction,
  updateProjectAction,
} from "../../../projects/actions";
import { getProject } from "../../../projects/operations";
import { PilotNav } from "../../pilot-nav";
import { DeleteProjectDialog } from "../delete-project-dialog";
import { ProjectForm } from "../project-form";
import { ProjectStateForm } from "../project-state-form";

export const metadata = {
  title: "Project · DevFlow",
};

async function ProjectContent({ params }: { params: Promise<{ projectId: string }> }) {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status === "unauthenticated") {
    redirect("/sign-in");
  }
  if (admission.status === "unapproved") {
    redirect(`/sign-in?error=${PILOT_NOT_APPROVED_CODE}`);
  }

  const { projectId } = await params;
  const result = await getProject(requestHeaders, projectId);
  if (!result.ok) {
    if (result.code === "unauthenticated") {
      redirect("/sign-in");
    }
    if (result.code === "unapproved") {
      redirect(`/sign-in?error=${PILOT_NOT_APPROVED_CODE}`);
    }
    notFound();
  }

  const project = result.project;
  const archived = project.archivedAt !== null;

  return (
    <main>
      <PilotNav current="projects" />
      <p>
        <Link href={archived ? "/projects?view=archived" : "/projects"}>Back to projects</Link>
      </p>
      <h1>{project.name}</h1>
      <p>{archived ? "Archived" : "Active"}</p>
      {project.description ? (
        <p className="project-description">{project.description}</p>
      ) : (
        <p>No description.</p>
      )}
      <p>
        Updated <time dateTime={project.updatedAt}>{project.updatedAt}</time>
      </p>
      {archived ? (
        <ProjectStateForm
          key="restore"
          projectId={project.id}
          submitAction={restoreProjectAction}
          label="Restore project"
          pendingLabel="Restoring project..."
        />
      ) : (
        <>
          <ProjectForm
            key={project.updatedAt}
            mode="edit"
            projectId={project.id}
            initialName={project.name}
            initialDescription={project.description ?? ""}
            submitAction={updateProjectAction}
          />
          <ProjectStateForm
            key="archive"
            projectId={project.id}
            submitAction={archiveProjectAction}
            label="Archive project"
            pendingLabel="Archiving project..."
          />
        </>
      )}
      <DeleteProjectDialog projectId={project.id} deleteAction={deleteProjectAction} />
    </main>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Suspense fallback={null}>
      <ProjectContent params={params} />
    </Suspense>
  );
}
