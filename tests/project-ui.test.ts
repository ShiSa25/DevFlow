import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CHANGES_SAVED_MESSAGE, DELETE_PERMANENT_MESSAGE, FIELD_MESSAGES } from "../src/projects/messages";
import { idleProjectActionState, type ProjectActionState, type ProjectFormAction } from "../src/projects/types";

const SECRET_INPUT = "postgres://user:secret@db.example/devflow";

type TestNode = {
  textContent: string | null;
  id?: string;
  open?: boolean;
  value?: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  focus(): void;
  dispatchEvent(event: object): boolean;
  querySelector(selector: string): TestNode | null;
};

type View = {
  click(selector: string): Promise<void>;
  submit(selector: string): Promise<void>;
  requestSubmitTwice(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  rerender(node: unknown): Promise<void>;
  text(): string;
  element(selector: string): TestNode;
  query(selector: string): TestNode | null;
  active(): TestNode | null;
  unmount(): Promise<void>;
};

async function render(node: unknown): Promise<View> {
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "http://127.0.0.1:3000/projects" });
  for (const [name, value] of [
    ["window", dom],
    ["document", dom.document],
    ["HTMLElement", dom.HTMLElement],
    ["HTMLInputElement", dom.HTMLInputElement],
    ["HTMLTextAreaElement", dom.HTMLTextAreaElement],
    ["HTMLFormElement", dom.HTMLFormElement],
    ["HTMLDialogElement", dom.HTMLDialogElement],
    ["HTMLButtonElement", dom.HTMLButtonElement],
    ["Node", dom.Node],
    ["navigator", dom.navigator],
    ["FormData", dom.FormData],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
  await React.act(async () => {
    root.render(node as Parameters<typeof root.render>[0]);
  });

  function element(selector: string): TestNode {
    const found = container.querySelector(selector);
    assert.ok(found, `missing ${selector}`);
    return found as unknown as TestNode;
  }

  return {
    async click(selector: string) {
      await React.act(async () => {
        element(selector).dispatchEvent(new dom.MouseEvent("click", { bubbles: true }));
      });
    },
    async submit(selector: string) {
      await React.act(async () => {
        element(selector).dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
      });
    },
    async requestSubmitTwice(selector: string) {
      await React.act(async () => {
        const form = element(selector);
        const event = () => new dom.Event("submit", { bubbles: true, cancelable: true });
        form.dispatchEvent(event());
        form.dispatchEvent(event());
      });
    },
    async fill(selector: string, value: string) {
      await React.act(async () => {
        const node = element(selector) as unknown as {
          tagName: string;
          value: string;
          dispatchEvent(event: object): boolean;
        };
        const prototype =
          node.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(node, value);
        node.dispatchEvent(new dom.Event("input", { bubbles: true }));
      });
    },
    async rerender(node: unknown) {
      await React.act(async () => {
        root.render(node as Parameters<typeof root.render>[0]);
      });
    },
    text() {
      return container.textContent ?? "";
    },
    element,
    query(selector: string) {
      return container.querySelector(selector) as unknown as TestNode | null;
    },
    active() {
      return dom.document.activeElement as unknown as TestNode | null;
    },
    async unmount() {
      await React.act(async () => {
        root.unmount();
      });
      await dom.close();
    },
  };
}

describe("project forms and delete dialog", () => {
  const views: View[] = [];

  after(async () => {
    for (const view of views) {
      await view.unmount();
    }
  });

  it("disables the create control while a submit is pending and announces a field error", async () => {
    const React = await import("react");
    const { ProjectForm } = await import("../src/app/projects/project-form");
    let release: ((state: ProjectActionState) => void) | undefined;
    let calls = 0;
    const submitAction: ProjectFormAction = (_previous, formData) => {
      calls += 1;
      assert.equal(formData.get("ownerId"), null);
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const view = await render(
      React.createElement(ProjectForm, { mode: "create", submitAction }),
    );
    views.push(view);

    const name = view.element("#create-project-name");
    assert.equal(name.getAttribute("aria-invalid"), null);
    await view.fill("#create-project-name", SECRET_INPUT);
    await view.fill("#create-project-description", "Notes");

    const pending = view.requestSubmitTwice("form");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
    const button = view.element("button[type='submit']");
    assert.equal(button.hasAttribute("disabled"), true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.match(button.textContent ?? "", /Creating project/);

    assert.ok(release);
    const ReactAct = (await import("react")).act;
    await ReactAct(async () => {
      release?.({
        code: "invalid",
        fieldErrors: { name: FIELD_MESSAGES.name },
        message: null,
      });
    });
    await pending;

    assert.equal(button.hasAttribute("disabled"), false);
    const alert = view.element("#create-project-name-error");
    assert.equal(alert.getAttribute("role"), "alert");
    assert.equal(alert.textContent, FIELD_MESSAGES.name);
    assert.equal(view.element("#create-project-name").getAttribute("aria-invalid"), "true");
    assert.equal(view.element("#create-project-name").getAttribute("aria-describedby"), "create-project-name-error");
    assert.equal(alert.textContent?.includes("secret"), false);
    assert.equal(alert.textContent?.includes("db.example"), false);
  });

  it("opens a permanent-delete dialog, returns focus, and blocks a second submit", async () => {
    const React = await import("react");
    const { DeleteProjectDialog } = await import("../src/app/projects/delete-project-dialog");
    let calls = 0;
    let confirmValue: FormDataEntryValue | null = null;
    let release: ((state: ProjectActionState) => void) | undefined;
    const deleteAction: ProjectFormAction = (_previous, formData) => {
      calls += 1;
      confirmValue = formData.get("confirm");
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const projectId = "00000000-0000-4000-8000-00000000000a";
    const view = await render(
      React.createElement(DeleteProjectDialog, { projectId, deleteAction }),
    );
    views.push(view);

    const opener = view.element("button");
    assert.equal(opener.textContent, "Delete project");
    opener.focus();
    await view.click("button");

    const dialog = view.element("dialog");
    assert.equal(dialog.open, true);
    const title = dialog.querySelector("h2");
    assert.equal(title?.textContent, "Delete project");
    assert.equal(dialog.getAttribute("aria-labelledby"), title?.id);
    assert.match(dialog.textContent ?? "", /permanent/i);
    assert.equal((dialog.textContent ?? "").toLowerCase().includes("task"), false);
    assert.equal(dialog.textContent?.includes(DELETE_PERMANENT_MESSAGE), true);
    const confirm = dialog.querySelector("input[name='confirm']");
    assert.ok(confirm);
    assert.equal(confirm.value, "delete");

    const pending = view.requestSubmitTwice("dialog form");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
    assert.equal(confirmValue, "delete");
    const submit = view.element("dialog button[type='submit']");
    assert.equal(submit.hasAttribute("disabled"), true);
    assert.match(submit.textContent ?? "", /Deleting project/);

    const ReactAct = (await import("react")).act;
    await ReactAct(async () => {
      release?.({
        code: "invalid",
        fieldErrors: { confirm: FIELD_MESSAGES.confirm },
        message: null,
      });
    });
    await pending;

    assert.equal(dialog.open, true);
    const alert = dialog.querySelector("[role='alert']");
    assert.equal(alert?.textContent, FIELD_MESSAGES.confirm);
    assert.equal(submit.hasAttribute("disabled"), false);

    await view.click("dialog button[type='button']");
    assert.equal(dialog.open, false);
    assert.equal(view.active(), opener);
    assert.equal(calls, 1);
    assert.equal(idleProjectActionState.code, "idle");
  });

  it("keeps a rejected create entry and submits that description on retry", async () => {
    const React = await import("react");
    const { ProjectForm } = await import("../src/app/projects/project-form");
    const submissions: Array<{ name: string; description: string }> = [];
    const submitAction: ProjectFormAction = async (_previous, formData) => {
      const enteredName = String(formData.get("name") ?? "");
      const enteredDescription = String(formData.get("description") ?? "");
      submissions.push({ name: enteredName, description: enteredDescription });
      if (enteredName.trim().length === 0) {
        return {
          code: "invalid",
          fieldErrors: { name: FIELD_MESSAGES.name },
          message: null,
        };
      }
      return { code: "success", fieldErrors: {}, message: null };
    };
    const view = await render(React.createElement(ProjectForm, { mode: "create", submitAction }));
    views.push(view);

    await view.fill("#create-project-name", "   ");
    await view.fill("#create-project-description", "Keep this description");
    await view.submit("form");

    assert.equal(view.element("#create-project-name").value, "   ");
    assert.equal(view.element("#create-project-description").value, "Keep this description");
    assert.equal(view.element("#create-project-name").getAttribute("aria-invalid"), "true");
    assert.equal(view.element("#create-project-name").getAttribute("aria-describedby"), "create-project-name-error");
    assert.equal(view.element("#create-project-name-error").getAttribute("role"), "alert");
    assert.equal(view.element("#create-project-name-error").textContent, FIELD_MESSAGES.name);
    assert.equal(view.element("button[type='submit']").hasAttribute("disabled"), false);

    await view.fill("#create-project-name", "Launch");
    await view.submit("form");

    assert.deepEqual(submissions, [
      { name: "   ", description: "Keep this description" },
      { name: "Launch", description: "Keep this description" },
    ]);
  });

  it("keeps a rejected edit, retries it, and retains the saved confirmation", async () => {
    const React = await import("react");
    const { ProjectForm } = await import("../src/app/projects/project-form");
    const projectId = "00000000-0000-4000-8000-00000000000b";
    const otherProjectId = "00000000-0000-4000-8000-00000000000c";
    const submissions: Array<{ name: string; description: string; id: string }> = [];
    const submitAction: ProjectFormAction = async (_previous, formData) => {
      const enteredName = String(formData.get("name") ?? "");
      const enteredDescription = String(formData.get("description") ?? "");
      submissions.push({
        name: enteredName,
        description: enteredDescription,
        id: String(formData.get("id") ?? ""),
      });
      if (enteredName.trim().length === 0) {
        return {
          code: "invalid",
          fieldErrors: { name: FIELD_MESSAGES.name },
          message: null,
        };
      }
      return { code: "success", fieldErrors: {}, message: CHANGES_SAVED_MESSAGE };
    };
    const form = (id: string, initialName: string, initialDescription: string) =>
      React.createElement(ProjectForm, {
        key: id,
        mode: "edit",
        projectId: id,
        initialName,
        initialDescription,
        submitAction,
      });
    const view = await render(form(projectId, "Saved name", "Saved description"));
    views.push(view);

    await view.fill("#edit-project-name", "   ");
    await view.fill("#edit-project-description", "Intended description");
    await view.submit("form");

    assert.equal(view.element("#edit-project-name").value, "   ");
    assert.equal(view.element("#edit-project-description").value, "Intended description");
    assert.notEqual(view.element("#edit-project-name").value, "Saved name");
    assert.notEqual(view.element("#edit-project-description").value, "Saved description");
    assert.equal(view.element("#edit-project-name-error").textContent, FIELD_MESSAGES.name);

    await view.fill("#edit-project-name", "  Renamed project  ");
    await view.submit("form");

    assert.deepEqual(submissions, [
      { name: "   ", description: "Intended description", id: projectId },
      { name: "  Renamed project  ", description: "Intended description", id: projectId },
    ]);
    assert.equal(view.element("#edit-project-form-error").textContent, CHANGES_SAVED_MESSAGE);

    await view.rerender(form(projectId, "Renamed project", "Intended description"));

    assert.equal(view.element("#edit-project-form-error").textContent, CHANGES_SAVED_MESSAGE);
    assert.equal(view.element("#edit-project-name").value, "Renamed project");
    assert.equal(view.element("#edit-project-description").value, "Intended description");

    await view.rerender(form(otherProjectId, "Other project", "Other notes"));

    assert.equal(view.query("#edit-project-form-error"), null);
    assert.equal(view.text().includes(CHANGES_SAVED_MESSAGE), false);
    assert.equal(view.element("#edit-project-name").value, "Other project");
    assert.equal(view.element("#edit-project-description").value, "Other notes");
  });
});
