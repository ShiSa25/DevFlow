import { z } from "zod";
import { FIELD_MESSAGES } from "./messages";
import type { FieldErrors, ProjectField, ProjectView } from "./types";

const PROJECT_FIELDS = new Set<string>(Object.keys(FIELD_MESSAGES));
const MAX_PAGE = 1_000_000;

export const projectIdSchema = z.uuid().transform((value) => value.toLowerCase());

export const projectNameSchema = z.string().trim().min(1).max(100);

export const projectDescriptionSchema = z.union([
  z.string().trim().max(5000).transform((value) => (value.length === 0 ? null : value)),
  z.null().transform(() => null),
  z.undefined().transform(() => null),
]);

export const createProjectSchema = z.strictObject({
  name: projectNameSchema,
  description: projectDescriptionSchema.optional(),
});

export const updateProjectSchema = z.strictObject({
  id: projectIdSchema,
  name: projectNameSchema,
  description: projectDescriptionSchema.optional(),
});

export const projectIdInputSchema = z.strictObject({
  id: projectIdSchema,
});

export const deleteProjectSchema = z.strictObject({
  id: projectIdSchema,
  confirm: z.literal("delete"),
});

const viewSchema = z.enum(["active", "archived"]);
const pageSchema = z.string().regex(/^[1-9][0-9]*$/);

export type ParsedProjectList =
  | { ok: true; view: ProjectView; page: number }
  | { ok: false; code: "invalid"; fieldErrors: FieldErrors };

export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || !PROJECT_FIELDS.has(key) || fieldErrors[key as ProjectField]) {
      continue;
    }
    fieldErrors[key as ProjectField] = FIELD_MESSAGES[key as ProjectField];
  }
  return fieldErrors;
}

function readSingleParam(value: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  return { ok: true, value };
}

/**
 * Parse the project list query. Repeated keys and non-strings are invalid.
 * Absent view and page use the defaults. A page past the end is still a
 * valid page number; the query returns an empty page.
 */
export function parseProjectListParams(input: unknown): ParsedProjectList {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: "invalid",
      fieldErrors: { view: FIELD_MESSAGES.view, page: FIELD_MESSAGES.page },
    };
  }

  const record = input as Record<string, unknown>;
  const fieldErrors: FieldErrors = {};
  let view: ProjectView = "active";
  let page = 1;

  const rawView = readSingleParam(record.view);
  if (!rawView.ok) {
    fieldErrors.view = FIELD_MESSAGES.view;
  } else if (rawView.value !== undefined) {
    const parsed = viewSchema.safeParse(rawView.value);
    if (!parsed.success) {
      fieldErrors.view = FIELD_MESSAGES.view;
    } else {
      view = parsed.data;
    }
  }

  const rawPage = readSingleParam(record.page);
  if (!rawPage.ok) {
    fieldErrors.page = FIELD_MESSAGES.page;
  } else if (rawPage.value !== undefined) {
    const parsed = pageSchema.safeParse(rawPage.value);
    const numeric = parsed.success ? Number(parsed.data) : Number.NaN;
    if (!parsed.success || !Number.isSafeInteger(numeric) || numeric < 1 || numeric > MAX_PAGE) {
      fieldErrors.page = FIELD_MESSAGES.page;
    } else {
      page = numeric;
    }
  }

  if (fieldErrors.view || fieldErrors.page) {
    return { ok: false, code: "invalid", fieldErrors };
  }
  return { ok: true, view, page };
}

function formText(formData: FormData, key: string): unknown {
  const values = formData.getAll(key);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length > 1) {
    return { repeated: true };
  }
  const value = values[0];
  return typeof value === "string" ? value : { invalid: true };
}

export function createInputFromFormData(formData: FormData): {
  name: unknown;
  description: unknown;
} {
  return {
    name: formText(formData, "name"),
    description: formText(formData, "description"),
  };
}

export function updateInputFromFormData(formData: FormData): {
  id: unknown;
  name: unknown;
  description: unknown;
} {
  return {
    id: formText(formData, "id"),
    name: formText(formData, "name"),
    description: formText(formData, "description"),
  };
}

export function idInputFromFormData(formData: FormData): { id: unknown } {
  return { id: formText(formData, "id") };
}

export function deleteInputFromFormData(formData: FormData): { id: unknown; confirm: unknown } {
  return {
    id: formText(formData, "id"),
    confirm: formText(formData, "confirm"),
  };
}
