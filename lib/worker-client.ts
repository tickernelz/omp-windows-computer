import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { resolveHost, type HostInfo } from "./host.ts";
import { loadConfig, type WinComputerConfig } from "./config.ts";

export interface WorkerCallOptions {
  signal?: AbortSignal;
  idempotent?: boolean;
  timeoutMs?: number;
}

export interface WorkerSpawnFn {
  (command: string, args: string[], options: { stdio: ["pipe", "pipe", "pipe"] }): ChildProcess;
}

export class WindowsWorker {
  #process: ChildProcess | null = null;
  #readline: readline.Interface | null = null;
  #pending = new Map<number, { resolve: (res: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout; method: string }>();
  #seq = 0;
  #readyPromise: Promise<void> | null = null;
  #readyResolve: (() => void) | null = null;
  #readyReject: ((err: Error) => void) | null = null;
  #hostInfo: HostInfo;
  #config: WinComputerConfig;
  #stagedScriptWinPath = "";
  #stagedScriptHostPath = "";
  #stderrTail: string[] = [];
  #spawnFn: WorkerSpawnFn;
  #queue: Array<() => Promise<void>> = [];
  #busy = false;
  #sessionId: string;

  constructor(options: { hostInfo?: HostInfo; config?: WinComputerConfig; spawnFn?: WorkerSpawnFn; sessionId?: string } = {}) {
    this.#config = options.config || loadConfig();
    this.#spawnFn = options.spawnFn || ((cmd, args, opts) => spawn(cmd, args, opts));
    this.#sessionId = options.sessionId || `session-${process.pid}-${Date.now()}`;
    this.#hostInfo = options.hostInfo || resolveHost({
      explicitShellPath: this.#config.shellPath,
      shellPreference: this.#config.shell
    });
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get hostInfo(): HostInfo {
    return this.#hostInfo;
  }

  get isAlive(): boolean {
    return this.#process !== null && !this.#process.killed && this.#process.exitCode === null;
  }

  get stagedScriptPath(): string {
    return this.#stagedScriptHostPath;
  }

  async ensureReady(): Promise<void> {
    if (this.isAlive && this.#readyPromise) {
      return this.#readyPromise;
    }
    await this.#startWorker();
    return this.#readyPromise!;
  }

  async #stageScript(): Promise<void> {
    const workerScriptSource = path.join(path.dirname(new URL(import.meta.url).pathname), "scripts", "win32-worker.ps1");
    const scriptContent = fs.readFileSync(workerScriptSource);
    const hash = crypto.createHash("sha256").update(scriptContent).digest("hex").slice(0, 12);

    const tempDir = this.#hostInfo.tempDirHost;
    fs.mkdirSync(tempDir, { recursive: true });

    const stagedFileName = `win32-worker-${hash}.ps1`;
    this.#stagedScriptHostPath = path.join(tempDir, stagedFileName);
    this.#stagedScriptWinPath = `${this.#hostInfo.tempDirWindows}\\${stagedFileName}`;

    if (!fs.existsSync(this.#stagedScriptHostPath)) {
      const tmpStaged = `${this.#stagedScriptHostPath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmpStaged, scriptContent);
      fs.renameSync(tmpStaged, this.#stagedScriptHostPath);
    }
  }

  async #startWorker(): Promise<void> {
    this.#disposeProcess();
    await this.#stageScript();

    this.#readyPromise = new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });

    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-ExecutionPolicy", "Bypass",
      "-File", this.#stagedScriptWinPath
    ];

    try {
      this.#process = this.#spawnFn(this.#hostInfo.shellPath, args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (err: any) {
      this.#readyReject?.(new Error(`WorkerSpawnFailed: ${err.message}`));
      throw err;
    }

    this.#stderrTail = [];
    this.#process.stderr?.on("data", (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      this.#stderrTail.push(str);
      if (this.#stderrTail.length > 20) this.#stderrTail.shift();
    });

    this.#process.on("error", (err) => {
      this.#handleWorkerExit(null, String(err));
    });

    this.#process.on("exit", (code, signal) => {
      this.#handleWorkerExit(code, signal);
    });

    this.#readline = readline.createInterface({ input: this.#process.stdout! });
    this.#readline.on("line", (line) => this.#handleLine(line));

    const readyTimeout = setTimeout(() => {
      if (this.#readyReject) {
        this.#readyReject(new Error(`WorkerTimeout: worker handshake timed out after 10000ms. Stderr: ${this.#stderrTail.join("")}`));
        this.dispose();
      }
    }, 10000);

    this.#readyPromise.finally(() => clearTimeout(readyTimeout));
  }

  #handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const data = JSON.parse(trimmed);
      if (data.ready !== undefined) {
        if (data.ready) {
          this.#readyResolve?.();
        } else {
          this.#readyReject?.(new Error(`WorkerStartupFailed: ${data.error || "Unknown worker startup error"}`));
        }
        return;
      }

      const id = data.id;
      if (typeof id === "number" && this.#pending.has(id)) {
        const { resolve, reject, timer } = this.#pending.get(id)!;
        clearTimeout(timer);
        this.#pending.delete(id);

        if (data.ok) {
          resolve(data.result);
        } else {
          reject(new Error(data.error || "WorkerError: call failed with no message"));
        }
      }
    } catch {}
  }

  #handleWorkerExit(code: number | null, signal: string | null): void {
    const stderr = this.#stderrTail.join("").trim();
    const err = new Error(`WorkerExited: process exited (code=${code}, signal=${signal}). Stderr: ${stderr}`);

    if (this.#readyReject) {
      this.#readyReject(err);
    }

    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
    this.#process = null;
    this.#readline = null;
  }

  async call<T = any>(method: string, params: Record<string, unknown> = {}, options: WorkerCallOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#queue.push(async () => {
        try {
          const res = await this.#executeCall<T>(method, params, options);
          resolve(res);
        } catch (err: any) {
          if (options.idempotent && !this.isAlive) {
            try {
              await this.ensureReady();
              const retryRes = await this.#executeCall<T>(method, params, { ...options, idempotent: false });
              resolve(retryRes);
              return;
            } catch (retryErr) {
              reject(retryErr);
              return;
            }
          }
          reject(err);
        }
      });
      this.#processQueue();
    });
  }

  async #processQueue(): Promise<void> {
    if (this.#busy || this.#queue.length === 0) return;
    this.#busy = true;
    const task = this.#queue.shift()!;
    try {
      await task();
    } finally {
      this.#busy = false;
      this.#processQueue();
    }
  }

  async #executeCall<T>(method: string, params: Record<string, unknown>, options: WorkerCallOptions): Promise<T> {
    if (options.signal?.aborted) {
      throw new Error(`Aborted: call to ${method} was aborted`);
    }

    await this.ensureReady();

    if (!this.isAlive) {
      throw new Error(`WorkerUnavailable: worker process is not running`);
    }

    const id = ++this.#seq;
    const timeoutMs = options.timeoutMs || (method === "capture" || method === "ax.snapshot" ? this.#config.captureTimeoutMs : this.#config.callTimeoutMs);

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (this.#pending.has(id)) {
          const p = this.#pending.get(id)!;
          clearTimeout(p.timer);
          this.#pending.delete(id);
          reject(new Error(`Aborted: call to ${method} was aborted`));
        }
      };

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`WorkerTimeout: call to ${method} exceeded ${timeoutMs}ms`));
          this.dispose();
        }
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (res) => {
          if (options.signal) options.signal.removeEventListener("abort", onAbort);
          resolve(res);
        },
        reject: (err) => {
          if (options.signal) options.signal.removeEventListener("abort", onAbort);
          reject(err);
        },
        timer,
        method
      });

      const payload = JSON.stringify({ id, method, params }) + "\n";
      try {
        this.#process!.stdin!.write(payload, "utf8");
      } catch (writeErr: any) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(writeErr);
      }
    });
  }

  #disposeProcess(): void {
    if (this.#readline) {
      this.#readline.close();
      this.#readline = null;
    }
    if (this.#process) {
      try {
        if (!this.#process.killed) {
          this.#process.stdin?.write(JSON.stringify({ id: 99999, method: "shutdown", params: {} }) + "\n");
          setTimeout(() => {
            if (this.#process && !this.#process.killed) {
              this.#process.kill("SIGKILL");
            }
          }, 500).unref();
        }
      } catch {}
      this.#process = null;
    }
  }

  dispose(): void {
    this.#disposeProcess();
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new Error("WorkerDisposed: worker client was disposed"));
    }
    this.#pending.clear();
    this.#readyPromise = null;
  }

  restart(): void {
    this.dispose();
    this.#stagedScriptWinPath = "";
    this.#stagedScriptHostPath = "";
  }
}
