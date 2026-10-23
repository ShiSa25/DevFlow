"use client";

import { useEffect, useRef, useState, type RefCallback } from "react";

/**
 * Ignore a second submit until the current one settles. The listener runs
 * during capture, before the submit reaches the action, so a second event
 * in the same turn cannot start another request.
 */
export function useSingleSubmit(pending: boolean): RefCallback<HTMLFormElement> {
  const pendingRef = useRef(false);
  const [form, setForm] = useState<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!pending) {
      pendingRef.current = false;
    }
  }, [pending]);

  useEffect(() => {
    if (!form) {
      return;
    }
    const onSubmit = (event: Event) => {
      if (pendingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      pendingRef.current = true;
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [form]);

  return (node) => {
    setForm((current) => (current === node ? current : node));
  };
}
