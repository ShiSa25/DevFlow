import type { FIELD_MESSAGES } from "./messages";

export type ProjectField = keyof typeof FIELD_MESSAGES;

export type FieldErrors = Partial<Record<ProjectField, string>>;

export type ProjectView = "active" | "archived";

export type ProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectListItem = {
  id: string;
  name: string;
  updatedAt: string;
};

export type AdmissionCode = "unauthenticated" | "unapproved";

export type AdmissionFailure = {
  ok: false;
  code: AdmissionCode;
};

export type InvalidResult = {
  ok: false;
  code: "invalid";
  fieldErrors: FieldErrors;
};

export type NotFoundResult = {
  ok: false;
  code: "not_found";
};

export type ArchivedResult = {
  ok: false;
  code: "archived";
};

export type ProjectFailure = AdmissionFailure | InvalidResult | NotFoundResult | ArchivedResult;

export type ProjectSuccess = {
  ok: true;
  code: "success";
  project: ProjectRecord;
};

export type DeleteSuccess = {
  ok: true;
  code: "success";
};

export type ListSuccess = {
  ok: true;
  code: "success";
  view: ProjectView;
  page: number;
  pageSize: number;
  total: number;
  projects: ProjectListItem[];
};

export type ProjectActionState = {
  code: "idle" | ProjectFailure["code"] | "success";
  fieldErrors: FieldErrors;
  message: string | null;
};

export const idleProjectActionState: ProjectActionState = {
  code: "idle",
  fieldErrors: {},
  message: null,
};

export type ProjectFormAction = (
  previous: ProjectActionState,
  formData: FormData,
) => Promise<ProjectActionState>;
