"use client";

import { useActionState } from "react";
import { idleProjectActionState, type ProjectFormAction } from "../../projects/types";
import { useSingleSubmit } from "./use-single-submit";

export function ProjectForm({
  mode,
  projectId,
  initialName = "",
  initialDescription = "",
  submitAction,
}: {
  mode: "create" | "edit";
  projectId?: string;
  initialName?: string;
  initialDescription?: string;
  submitAction: ProjectFormAction;
}) {
  const [state, formAction, pending] = useActionState(submitAction, idleProjectActionState);
  const formRef = useSingleSubmit(pending);
  const nameId = `${mode}-project-name`;
  const descriptionId = `${mode}-project-description`;
  const nameErrorId = `${nameId}-error`;
  const descriptionErrorId = `${descriptionId}-error`;
  const formErrorId = `${mode}-project-form-error`;
  const pendingLabel = mode === "create" ? "Creating project..." : "Saving changes...";
  const label = mode === "create" ? "Create project" : "Save changes";

  return (
    <form ref={formRef} action={formAction}>
      {projectId ? <input type="hidden" name="id" value={projectId} /> : null}
      {state.message ? (
        <p id={formErrorId} role="alert">
          {state.message}
        </p>
      ) : null}
      <label htmlFor={nameId}>Name</label>
      <input
        id={nameId}
        name="name"
        type="text"
        required
        minLength={1}
        maxLength={100}
        defaultValue={initialName}
        autoComplete="off"
        aria-invalid={state.fieldErrors.name ? true : undefined}
        aria-describedby={state.fieldErrors.name ? nameErrorId : undefined}
      />
      {state.fieldErrors.name ? (
        <p id={nameErrorId} className="form-error" role="alert">
          {state.fieldErrors.name}
        </p>
      ) : null}
      <label htmlFor={descriptionId}>Description</label>
      <textarea
        id={descriptionId}
        name="description"
        rows={5}
        maxLength={5000}
        defaultValue={initialDescription}
        aria-invalid={state.fieldErrors.description ? true : undefined}
        aria-describedby={state.fieldErrors.description ? descriptionErrorId : undefined}
      />
      {state.fieldErrors.description ? (
        <p id={descriptionErrorId} className="form-error" role="alert">
          {state.fieldErrors.description}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? pendingLabel : label}
        </button>
      </div>
    </form>
  );
}
