"use client";

import { useActionState } from "react";
import { idleProjectActionState, type ProjectFormAction } from "../../projects/types";
import { useSingleSubmit } from "./use-single-submit";

export function ProjectStateForm({
  projectId,
  submitAction,
  label,
  pendingLabel,
}: {
  projectId: string;
  submitAction: ProjectFormAction;
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(submitAction, idleProjectActionState);
  const formRef = useSingleSubmit(pending);

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="id" value={projectId} />
      <button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state.message ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
