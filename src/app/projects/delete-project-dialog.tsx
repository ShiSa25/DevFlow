"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { DELETE_PERMANENT_MESSAGE } from "../../projects/messages";
import { idleProjectActionState, type ProjectFormAction } from "../../projects/types";
import { useSingleSubmit } from "./use-single-submit";

export function DeleteProjectDialog({
  projectId,
  deleteAction,
}: {
  projectId: string;
  deleteAction: ProjectFormAction;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [state, formAction, pending] = useActionState(deleteAction, idleProjectActionState);
  const formRef = useSingleSubmit(pending);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const returnFocus = () => {
      openerRef.current?.focus();
    };
    dialog.addEventListener("close", returnFocus);
    return () => dialog.removeEventListener("close", returnFocus);
  }, []);

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      return;
    }
    dialog.showModal();
    cancelRef.current?.focus();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" ref={openerRef} onClick={openDialog}>
        Delete project
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-modal="true"
      >
        <h2 id={titleId}>Delete project</h2>
        <p id={descriptionId}>{DELETE_PERMANENT_MESSAGE}</p>
        {state.fieldErrors.confirm ? <p role="alert">{state.fieldErrors.confirm}</p> : null}
        {state.message ? <p role="alert">{state.message}</p> : null}
        <form ref={formRef} action={formAction}>
          <input type="hidden" name="id" value={projectId} />
          <input type="hidden" name="confirm" value="delete" />
          <div className="dialog-actions">
            <button type="button" ref={cancelRef} onClick={closeDialog}>
              Cancel
            </button>
            <button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? "Deleting project..." : "Delete permanently"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
