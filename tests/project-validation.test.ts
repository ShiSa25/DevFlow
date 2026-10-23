import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectListHref } from "../src/projects/links";
import { FIELD_MESSAGES } from "../src/projects/messages";
import {
  createInputFromFormData,
  createProjectSchema,
  deleteInputFromFormData,
  deleteProjectSchema,
  parseProjectListParams,
  updateProjectSchema,
} from "../src/projects/validation";

const ID = "00000000-0000-4000-8000-00000000000a";

describe("project validation", () => {
  it("trims the name and stores an empty description as null", () => {
    const parsed = createProjectSchema.safeParse({
      name: "  Launch plan  ",
      description: "   ",
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.name, "Launch plan");
      assert.equal(parsed.data.description, null);
    }
  });

  it("rejects a blank name, a long name, a long description, and an owner id", () => {
    const blank = createProjectSchema.safeParse({ name: "   ", description: "ok" });
    const longName = createProjectSchema.safeParse({ name: "a".repeat(101), description: "" });
    const longDescription = createProjectSchema.safeParse({
      name: "Ok",
      description: "a".repeat(5001),
    });
    const owner = createProjectSchema.safeParse({
      name: "Ok",
      description: "Ok",
      ownerId: "user-byron",
    });
    assert.equal(blank.success, false);
    assert.equal(longName.success, false);
    assert.equal(longDescription.success, false);
    assert.equal(owner.success, false);
    assert.equal(JSON.stringify(owner).includes("user-byron"), false);
  });

  it("lowercases a project id and requires confirm to be delete", () => {
    const updated = updateProjectSchema.safeParse({
      id: ID.toUpperCase(),
      name: "Ok",
    });
    assert.equal(updated.success, true);
    if (updated.success) {
      assert.equal(updated.data.id, ID);
      assert.equal(updated.data.description, undefined);
    }

    const missing = deleteProjectSchema.safeParse({ id: ID });
    const wrong = deleteProjectSchema.safeParse({ id: ID, confirm: "Delete" });
    const accepted = deleteProjectSchema.safeParse({ id: ID, confirm: "delete" });
    assert.equal(missing.success, false);
    assert.equal(wrong.success, false);
    assert.equal(accepted.success, true);
  });

  it("rejects repeated, missing, and malformed list parameters", () => {
    const defaults = parseProjectListParams({});
    assert.deepEqual(defaults, { ok: true, view: "active", page: 1 });

    const explicit = parseProjectListParams({ view: "archived", page: "3" });
    assert.deepEqual(explicit, { ok: true, view: "archived", page: 3 });

    const repeated = parseProjectListParams({ view: ["active", "archived"], page: "2" });
    assert.equal(repeated.ok, false);
    if (!repeated.ok) {
      assert.equal(repeated.code, "invalid");
      assert.equal(repeated.fieldErrors.view, FIELD_MESSAGES.view);
      assert.equal("projects" in repeated, false);
    }

    for (const page of ["0", "01", "1.5", "-1", "1000001", "nope", ["1", "2"]]) {
      const parsed = parseProjectListParams({ page });
      assert.equal(parsed.ok, false, `expected ${String(page)} to be invalid`);
      if (!parsed.ok) {
        assert.equal(parsed.fieldErrors.page, FIELD_MESSAGES.page);
      }
    }

    const badView = parseProjectListParams({ view: "ACTIVE" });
    assert.equal(badView.ok, false);
  });

  it("resets the page when a filter link is built", () => {
    assert.equal(projectListHref("active"), "/projects");
    assert.equal(projectListHref("active", 1), "/projects");
    assert.equal(projectListHref("active", 2), "/projects?page=2");
    assert.equal(projectListHref("archived"), "/projects?view=archived");
    assert.equal(projectListHref("archived", 3), "/projects?view=archived&page=3");
  });

  it("reads only the name, description, id, and confirm fields from a form", () => {
    const createForm = new FormData();
    createForm.set("name", "  Named  ");
    createForm.set("description", "  ");
    createForm.set("ownerId", "user-byron");
    const created = createInputFromFormData(createForm);
    assert.deepEqual(Object.keys(created).sort(), ["description", "name"]);
    assert.equal(JSON.stringify(created).includes("user-byron"), false);

    const repeated = new FormData();
    repeated.append("name", "One");
    repeated.append("name", "Two");
    repeated.set("description", "Ok");
    const repeatedInput = createProjectSchema.safeParse(createInputFromFormData(repeated));
    assert.equal(repeatedInput.success, false);

    const remove = new FormData();
    remove.set("id", ID);
    remove.set("confirm", "delete");
    remove.set("ownerId", "user-byron");
    const deleting = deleteInputFromFormData(remove);
    assert.deepEqual(deleting, { id: ID, confirm: "delete" });
  });
});
