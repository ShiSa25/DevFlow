"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
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
  const submitRef = useSingleSubmit(pending);
  const submitRefHolder = useRef(submitRef);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const entered = useRef({ name: initialName, description: initialDescription, projectId });
  const savedValues = useRef({ name: initialName, description: initialDescription });

  useEffect(() => {
    entered.current = { name, description, projectId };
  }, [name, description, projectId]);

  useEffect(() => {
    if (
      savedValues.current.name === initialName &&
      savedValues.current.description === initialDescription
    ) {
      return;
    }
    savedValues.current = { name: initialName, description: initialDescription };
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription]);

  const [formNode, setFormNode] = useState<HTMLFormElement | null>(null);
  const formRef = useCallback((node: HTMLFormElement | null) => {
    submitRefHolder.current(node);
    setFormNode((current) => (current === node ? current : node));
  }, []);

  useEffect(() => {
    if (!formNode) {
      return;
    }
    const restoreEnteredValues = (event: Event) => {
      event.preventDefault();
      const nameInput = formNode.querySelector("input[name='name']");
      const descriptionInput = formNode.querySelector("textarea[name='description']");
      const idInput = formNode.querySelector("input[name='id']");
      if (nameInput instanceof HTMLInputElement) {
        nameInput.value = entered.current.name;
      }
      if (descriptionInput instanceof HTMLTextAreaElement) {
        descriptionInput.value = entered.current.description;
      }
      const id = entered.current.projectId;
      if (idInput instanceof HTMLInputElement && id) {
        idInput.value = id;
      }
    };
    formNode.addEventListener("reset", restoreEnteredValues);
    return () => formNode.removeEventListener("reset", restoreEnteredValues);
  }, [formNode]);

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
        value={name}
        onChange={(event) => setName(event.target.value)}
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
        value={description}
        onChange={(event) => setDescription(event.target.value)}
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
