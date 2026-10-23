import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CdpResponse = {
  id?: number;
  error?: { message?: string };
  result?: Record<string, unknown>;
};

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  "/opt/google/chrome/chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/local/share/chromium/chrome-linux/chrome",
];

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
  private stderr = "";
  private readonly pending = new Map<number, {
    resolve: (value: CdpResponse) => void;
    reject: (error: Error) => void;
  }>();

  async open(origin: string, cookieValue: string): Promise<void> {
    const binary = resolveChromeBinary();
    const port = await freePort();
    this.profile = await mkdtemp(join(tmpdir(), "devflow-chrome-"));
    this.chrome = spawn(
      binary,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-breakpad",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--use-mock-keychain",
        "--metrics-recording-only",
        "--remote-allow-origins=*",
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.profile}`,
        "about:blank",
      ],
      {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "disabled:",
        },
      },
    );
    this.chrome.stdout?.on("data", (chunk: Buffer) => {
      this.noteOutput(chunk.toString());
    });
    this.chrome.stderr?.on("data", (chunk: Buffer) => {
      this.noteOutput(chunk.toString());
    });
    let launchFailed = false;
    const launchError = new Promise<never>((_resolve, reject) => {
      this.chrome?.once("error", (error) => {
        launchFailed = true;
        reject(new Error(`Could not start ${binary}: ${error.message}`));
      });
      this.chrome?.once("exit", (code, signal) => {
        if (launchFailed) {
          return;
        }
        launchFailed = true;
        reject(new Error(
          `Chrome exited before the debugging port opened (${exitDescription(code, signal)}). ${this.stderrTail()}`,
        ));
      });
    });
    launchError.catch(() => undefined);

    let pageSocket: string;
    try {
      pageSocket = await Promise.race([
        waitForPageSocket(port, () => this.stderrTail()),
        launchError,
      ]);
    } catch (error) {
      await this.close();
      throw error;
    }

    this.socket = new WebSocket(pageSocket);
    await new Promise<void>((resolve, reject) => {
      this.socket?.addEventListener("open", () => resolve(), { once: true });
      this.socket?.addEventListener(
        "error",
        () => reject(new Error(`Chrome socket failed. ${this.stderrTail()}`)),
        { once: true },
      );
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
      await rm(this.profile, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private noteOutput(text: string): void {
    this.stderr = `${this.stderr}${text}`.slice(-4_000);
  }

  private stderrTail(): string {
    const text = this.stderr.replace(/\s+/g, " ").trim();
    return text ? `Browser output: ${text.slice(-500)}` : "Browser output was empty.";
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

export function resolveChromeBinary(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Chrome or Chromium was not found. Install Google Chrome or set CHROME_BIN to the browser executable.",
  );
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

async function waitForPageSocket(port: number, output: () => string): Promise<string> {
  let lastError = "Chrome did not open a debugging port";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
        const page = pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
        lastError = "Chrome is listening, but no page target is available";
      } else {
        lastError = `Chrome debugging endpoint returned HTTP ${response.status}`;
      }
    } catch (error) {
      const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
      const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
      lastError = code ? `${error instanceof Error ? error.message : "fetch failed"} (${code})` : (
        error instanceof Error ? error.message : "fetch failed"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${lastError}. ${output()}`);
}

function exitDescription(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `signal ${signal}`;
  }
  return `code ${code ?? "unknown"}`;
}
