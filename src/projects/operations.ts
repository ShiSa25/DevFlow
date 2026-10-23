import { and, count, desc, eq, isNotNull, isNull, type ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ZodError } from "zod";
import { requirePilot } from "../auth/server";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { project } from "../db/schema";
import { FIELD_MESSAGES, PROJECT_PAGE_SIZE } from "./messages";
import type {
  AdmissionFailure,
  ArchivedResult,
  DeleteSuccess,
  InvalidResult,
  ListSuccess,
  NotFoundResult,
  ProjectFailure,
  ProjectListItem,
  ProjectRecord,
  ProjectSuccess,
} from "./types";
import {
  createProjectSchema,
  deleteProjectSchema,
  fieldErrorsFromZod,
  parseProjectListParams,
  projectIdSchema,
  projectIdInputSchema,
  updateProjectSchema,
} from "./validation";

type ProjectTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const projectColumns = {
  id: project.id,
  name: project.name,
  description: project.description,
  archivedAt: project.archivedAt,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

function admissionFailure(code: AdmissionFailure["code"]): AdmissionFailure {
  return { ok: false, code };
}

function invalidResult(error: ZodError): InvalidResult {
  return { ok: false, code: "invalid", fieldErrors: fieldErrorsFromZod(error) };
}

function notFound(): NotFoundResult {
  return { ok: false, code: "not_found" };
}

function archivedResult(): ArchivedResult {
  return { ok: false, code: "archived" };
}

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function projectSuccess(row: ProjectRow): ProjectSuccess {
  return { ok: true, code: "success", project: toRecord(row) };
}

function ownedWhere(ownerId: string, id: string) {
  return and(eq(project.id, id), eq(project.ownerId, ownerId));
}

async function lockOwned(tx: ProjectTx, ownerId: string, id: string): Promise<ProjectRow | null> {
  const rows = await tx
    .select(projectColumns)
    .from(project)
    .where(ownedWhere(ownerId, id))
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

export async function listProjects(requestHeaders: Headers, input: unknown): Promise<ListSuccess | AdmissionFailure | InvalidResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = parseProjectListParams(input);
  if (!parsed.ok) {
    return parsed;
  }

  const viewWhere = and(
    eq(project.ownerId, admission.user.id),
    parsed.view === "active" ? isNull(project.archivedAt) : isNotNull(project.archivedAt),
  );
  const offset = (parsed.page - 1) * PROJECT_PAGE_SIZE;
  const [rows, totals] = await Promise.all([
    getDb()
      .select({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
      })
      .from(project)
      .where(viewWhere)
      .orderBy(desc(project.updatedAt), desc(project.id))
      .limit(PROJECT_PAGE_SIZE)
      .offset(offset),
    getDb().select({ total: count() }).from(project).where(viewWhere),
  ]);

  const totalValue = Number(totals[0]?.total ?? 0);
  const total = Number.isFinite(totalValue) ? totalValue : 0;
  const projects: ProjectListItem[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return {
    ok: true,
    code: "success",
    view: parsed.view,
    page: parsed.page,
    pageSize: PROJECT_PAGE_SIZE,
    total,
    projects,
  };
}

export async function getProject(
  requestHeaders: Headers,
  projectId: unknown,
): Promise<ProjectSuccess | AdmissionFailure | InvalidResult | NotFoundResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = projectIdSchema.safeParse(projectId);
  if (!parsed.success) {
    return { ok: false, code: "invalid", fieldErrors: { id: FIELD_MESSAGES.id } };
  }

  const rows = await getDb()
    .select(projectColumns)
    .from(project)
    .where(ownedWhere(admission.user.id, parsed.data))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return notFound();
  }
  return projectSuccess(row);
}

export async function createProject(
  requestHeaders: Headers,
  input: unknown,
): Promise<ProjectSuccess | AdmissionFailure | InvalidResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const now = new Date();
  const inserted = await getDb()
    .insert(project)
    .values({
      ownerId: admission.user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning(projectColumns);
  const row = inserted[0];
  if (!row) {
    throw new Error("Project create did not return a row");
  }
  return projectSuccess(row);
}

export async function updateProject(
  requestHeaders: Headers,
  input: unknown,
): Promise<ProjectSuccess | ProjectFailure> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const ownerId = admission.user.id;
  const id = parsed.data.id;
  const description = parsed.data.description ?? null;
  const outcome = await getDb().transaction(async (tx) => {
    const current = await lockOwned(tx, ownerId, id);
    if (!current) {
      return { type: "not_found" as const };
    }
    if (current.archivedAt) {
      return { type: "archived" as const };
    }
    const updated = await tx
      .update(project)
      .set({
        name: parsed.data.name,
        description,
        updatedAt: new Date(),
      })
      .where(and(ownedWhere(ownerId, id), isNull(project.archivedAt)))
      .returning(projectColumns);
    const row = updated[0];
    if (!row) {
      return { type: "not_found" as const };
    }
    return { type: "success" as const, row };
  });

  if (outcome.type === "not_found") {
    return notFound();
  }
  if (outcome.type === "archived") {
    return archivedResult();
  }
  return projectSuccess(outcome.row);
}

export async function archiveProject(
  requestHeaders: Headers,
  input: unknown,
): Promise<ProjectSuccess | AdmissionFailure | InvalidResult | NotFoundResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = projectIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const ownerId = admission.user.id;
  const id = parsed.data.id;
  const outcome = await getDb().transaction(async (tx) => {
    const current = await lockOwned(tx, ownerId, id);
    if (!current) {
      return { type: "not_found" as const };
    }
    if (current.archivedAt) {
      return { type: "unchanged" as const, row: current };
    }
    const now = new Date();
    const updated = await tx
      .update(project)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(ownedWhere(ownerId, id), isNull(project.archivedAt)))
      .returning(projectColumns);
    const row = updated[0];
    if (!row) {
      return { type: "not_found" as const };
    }
    return { type: "success" as const, row };
  });

  if (outcome.type === "not_found") {
    return notFound();
  }
  return projectSuccess(outcome.row);
}

export async function restoreProject(
  requestHeaders: Headers,
  input: unknown,
): Promise<ProjectSuccess | AdmissionFailure | InvalidResult | NotFoundResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = projectIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const ownerId = admission.user.id;
  const id = parsed.data.id;
  const outcome = await getDb().transaction(async (tx) => {
    const current = await lockOwned(tx, ownerId, id);
    if (!current) {
      return { type: "not_found" as const };
    }
    if (!current.archivedAt) {
      return { type: "unchanged" as const, row: current };
    }
    const updated = await tx
      .update(project)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(ownedWhere(ownerId, id), isNotNull(project.archivedAt)))
      .returning(projectColumns);
    const row = updated[0];
    if (!row) {
      return { type: "not_found" as const };
    }
    return { type: "success" as const, row };
  });

  if (outcome.type === "not_found") {
    return notFound();
  }
  return projectSuccess(outcome.row);
}

export async function deleteProject(
  requestHeaders: Headers,
  input: unknown,
): Promise<DeleteSuccess | AdmissionFailure | InvalidResult | NotFoundResult> {
  const admission = await requirePilot(requestHeaders);
  if (admission.status !== "approved") {
    return admissionFailure(admission.status);
  }

  const parsed = deleteProjectSchema.safeParse(input);
  if (!parsed.success) {
    return invalidResult(parsed.error);
  }

  const deleted = await getDb()
    .delete(project)
    .where(ownedWhere(admission.user.id, parsed.data.id))
    .returning({ id: project.id });
  if (!deleted[0]) {
    return notFound();
  }
  return { ok: true, code: "success" };
}
