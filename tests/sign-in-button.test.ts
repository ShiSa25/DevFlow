import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { SIGN_IN_FAILED_MESSAGE } from "../src/auth/messages";

const RAW_FAILURE = "postgres://user:secret@db.example/devflow internal stack";

type SignIn = () => Promise<{ error?: unknown; data?: unknown } | null | undefined>;

async function renderButton(signIn: SignIn) {
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "http://127.0.0.1:3000/sign-in" });
  for (const [name, value] of [
    ["window", dom],
    ["document", dom.document],
    ["HTMLElement", dom.HTMLElement],
    ["Node", dom.Node],
    ["navigator", dom.navigator],
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
  const { SignInButton } = await import("../src/app/sign-in/sign-in-button");
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);

  await React.act(async () => {
    root.render(React.createElement(SignInButton, { signIn }));
  });

  const button = () => {
    const element = container.querySelector("button");
    assert.ok(element);
    return element;
  };

  return {
    async click() {
      await React.act(async () => {
        button().dispatchEvent(new dom.MouseEvent("click", { bubbles: true }));
      });
    },
    act: React.act,
    button,
    text() {
      return container.textContent ?? "";
    },
    async unmount() {
      await React.act(async () => {
        root.unmount();
      });
      await dom.close();
    },
  };
}

describe("Continue with GitHub button", () => {
  const views: Array<{ unmount: () => Promise<void> }> = [];

  after(async () => {
    for (const view of views) {
      await view.unmount();
    }
  });

  it("shows fixed error text after a resolved HTTP error and allows another click", async () => {
    let calls = 0;
    const view = await renderButton(async () => {
      calls += 1;
      return { data: null, error: { message: RAW_FAILURE, status: 403 } };
    });
    views.push(view);

    await view.click();

    assert.equal(view.button().disabled, false);
    assert.equal(view.button().getAttribute("aria-describedby"), "github-sign-in-error");
    const alert = view.button().ownerDocument.getElementById("github-sign-in-error");
    assert.equal(alert?.getAttribute("role"), "alert");
    assert.equal(alert?.textContent, SIGN_IN_FAILED_MESSAGE);
    assert.equal(view.text().includes(RAW_FAILURE), false);
    assert.equal(view.text().includes("secret"), false);

    await view.click();
    assert.equal(calls, 2);
  });

  it("shows the same fixed error after a thrown failure", async () => {
    const view = await renderButton(async () => {
      throw new Error(`network down ${RAW_FAILURE}`);
    });
    views.push(view);

    await view.click();

    assert.equal(view.button().disabled, false);
    assert.equal(
      view.button().ownerDocument.getElementById("github-sign-in-error")?.textContent,
      SIGN_IN_FAILED_MESSAGE,
    );
    assert.equal(view.text().includes("network down"), false);
    assert.equal(view.text().includes("db.example"), false);
  });

  it("ignores a second click while a redirect is pending and retries after failure", async () => {
    let release: ((value: { error?: unknown; data?: unknown }) => void) | undefined;
    let calls = 0;
    const view = await renderButton(
      () =>
        new Promise((resolve) => {
          calls += 1;
          if (calls === 1) {
            release = resolve;
            return;
          }
          resolve({ data: { url: "https://github.com/login/oauth/authorize", redirect: true } });
        }),
    );
    views.push(view);

    const firstClick = view.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(view.button().disabled, true);
    await view.click();
    assert.equal(calls, 1);

    assert.ok(release);
    await view.act(async () => {
      release?.({ error: { message: RAW_FAILURE, status: 500 } });
    });
    await firstClick;

    assert.equal(view.button().disabled, false);
    assert.equal(
      view.button().ownerDocument.getElementById("github-sign-in-error")?.textContent,
      SIGN_IN_FAILED_MESSAGE,
    );

    await view.click();
    assert.equal(calls, 2);
    assert.equal(view.button().disabled, true);
    assert.equal(view.button().ownerDocument.getElementById("github-sign-in-error"), null);
  });
});
