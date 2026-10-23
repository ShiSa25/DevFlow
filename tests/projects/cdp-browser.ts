import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CdpResponse = {
  id?: number;
  error?: { message?: string };
  result?: Record<string, unknown>;
};

/**
 * Drive one headless Chrome page through the DevTools protocol.
 * The session cookie is httpOnly, so it is set through the protocol
 * rather than page script.
 */
export class ChromePage {
  private chrome: ChildProcess | undefined;
  private socket: WebSocket | undefined;
  private profile = "";
  private nextId = 0;
  private readonly pending = new Map<number, {
    resolve: (value: CdpResponse) => void;
    reject: (error: Error) => void;
  }>();

  async open(origin: string, cookieValue: string): Promise<void> {
    const port = await freePort();
    this.profile = await mkdtemp(join(tmpdir(), "devflow-chrome-"));
    this.chrome = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--remote-allow-origins=*",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.profile}`,
        "about:blank",
      ],
      { detached: true, stdio: "ignore" },
    );

    const pageSocket = await waitForPageSocket(port);
    this.socket = new WebSocket(pageSocket);
    await new Promise<void>((resolve, reject) => {
      this.socket?.addEventListener("open", () => resolve(), { once: true });
      this.socket?.addEventListener("error", () => reject(new Error("Chrome socket failed")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (typeof message.id !== "number") {
        return;
      }
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      waiting?.resolve(message);
    });

    await this.send("Network.enable");
    await this.send("Page.enable");
    const cookie = await this.send("Network.setCookie", {
      name: "better-auth.session_token",
      value: cookieValue,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    });
    if (cookie.success !== true) {
      throw new Error("Could not store the session cookie");
    }
  }

  async goto(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const details = response.exceptionDetails as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (details) {
      throw new Error(details.exception?.description ?? details.text ?? "Page script failed");
    }
    const remote = response.result as { value?: T } | undefined;
    return remote?.value as T;
  }

  async close(): Promise<void> {
    this.socket?.close();
    if (this.chrome?.pid) {
      try {
        process.kill(-this.chrome.pid, "SIGKILL");
      } catch {
        this.chrome.kill("SIGKILL");
      }
    }
    if (this.profile) {
      await rm(this.profile, { recursive: true, force: true });
    }
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId + 1;
    this.nextId = id;
    const response = await new Promise<CdpResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket?.send(JSON.stringify({ id, method, params }));
    });
    if (response.error?.message) {
      throw new Error(response.error.message);
    }
    return response.result ?? {};
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a Chrome debugging port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPageSocket(port: number): Promise<string> {
  let lastError = "Chrome did not open a page";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
        const page = pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(lastError);
}
