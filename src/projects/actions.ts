"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePilot } from "../auth/server";
import { PILOT_NOT_APPROVED_MESSAGE } from "../auth/messages";
import {
  ARCHIVED_EDIT_MESSAGE,
  CHANGES_SAVED_MESSAGE,
  GENERIC_INVALID_MESSAGE,
  NOT_FOUND_MESSAGE,
  PROJECT_ARCHIVED_MESSAGE,
  PROJECT_RESTORED_MESSAGE,
  UNAUTHENTICATED_MESSAGE,
} from "./messages";
import {
  archiveProject,
  createProject,
  deleteProject,
  restoreProject,
  updateProject,
} from "./operations";
import type { ProjectActionState, ProjectFailure } from "./types";
import {
  createInputFromFormData,
  deleteInputFromFormData,
  deleteProjectSchema,
  idInputFromFormData,
  updateInputFromFormData,
} from "./validation";

function failureState(result: ProjectFailure): ProjectActionState {
  if (result.code === "invalid") {
    const hasField = Object.keys(result.fieldErrors).length > 0;
    return {
      code: "invalid",
      fieldErrors: result.fieldErrors,
      message: hasField ? null : GENERIC_INVALID_MESSAGE,
    };
  }
  if (result.code === "unauthenticated") {
    return { code: result.code, fieldErrors: {}, message: UNAUTHENTICATED_MESSAGE };
  }
  if (result.code === "unapproved") {
    return { code: result.code, fieldErrors: {}, message: PILOT_NOT_APPROVED_MESSAGE };
  }
  if (result.code === "archived") {
    return { code: result.code, fieldErrors: {}, message: ARCHIVED_EDIT_MESSAGE };
  }
  return { code: result.code, fieldErrors: {}, message: NOT_FOUND_MESSAGE };
}

function successState(message: string): ProjectActionState {
  return { code: "success", fieldErrors: {}, message };
}

export async function createProjectAction(
  _previous: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return failureState({ ok: false, code: admission.status });
  }

  const result = await createProject(requestHeaders, createInputFromFormData(formData));
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);
  redirect(`/projects/${result.project.id}`);
}

export async function updateProjectAction(
  _previous: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return failureState({ ok: false, code: admission.status });
  }

  const result = await updateProject(requestHeaders, updateInputFromFormData(formData));
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);
  return successState(CHANGES_SAVED_MESSAGE);
}

export async function archiveProjectAction(
  _previous: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return failureState({ ok: false, code: admission.status });
  }

  const result = await archiveProject(requestHeaders, idInputFromFormData(formData));
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);
  return successState(PROJECT_ARCHIVED_MESSAGE);
}

export async function restoreProjectAction(
  _previous: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return failureState({ ok: false, code: admission.status });
  }

  const result = await restoreProject(requestHeaders, idInputFromFormData(formData));
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${result.project.id}`);
  return successState(PROJECT_RESTORED_MESSAGE);
}

export async function deleteProjectAction(
  _previous: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const requestHeaders = await headers();
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return failureState({ ok: false, code: admission.status });
  }

  const input = deleteInputFromFormData(formData);
  const result = await deleteProject(requestHeaders, input);
  if (!result.ok) {
    return failureState(result);
  }
  revalidatePath("/projects");
  const parsed = deleteProjectSchema.safeParse(input);
  if (parsed.success) {
    revalidatePath(`/projects/${parsed.data.id}`);
  }
  redirect("/projects");
}
