import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { resolveHost, type HostInfo } from "./host.ts";
import { loadConfig, type WinComputerConfig } from "./config.ts";
import { resolveCuaDriverPath, ensureDriverInstalled, checkDriverUpdate, applyDriverUpdate, type CuaUpdateInfo } from "./driver-manager.ts";

export interface WorkerCallOptions {
  signal?: AbortSignal;
  idempotent?: boolean;
  timeoutMs?: number;
}

export class WindowsWorker {
  #driverPath: string | null = null;
  #hostInfo: HostInfo;
  #config: WinComputerConfig;
  #sessionId: string;
  #shotsDir: string = "";

  constructor(options: { hostInfo?: HostInfo; config?: WinComputerConfig; driverPath?: string; sessionId?: string } = {}) {
    this.#config = options.config || loadConfig();
    this.#sessionId = options.sessionId || "session-" + process.pid + "-" + Date.now();
    this.#hostInfo = options.hostInfo || resolveHost();
    this.#driverPath = options.driverPath || resolveCuaDriverPath(this.#config.driverPath, this.#hostInfo);

    const baseShots = this.#hostInfo.tempDirHost + "/shots";
    this.#shotsDir = path.join(baseShots, this.#sessionId);
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  get hostInfo(): HostInfo {
    return this.#hostInfo;
  }

  get driverPath(): string | null {
    return this.#driverPath;
  }

  get isAlive(): boolean {
    return this.#driverPath !== null && fs.existsSync(this.#driverPath);
  }

  get stagedScriptPath(): string {
    return this.#driverPath || "cua-driver (unresolved)";
  }

  async ensureReady(): Promise<void> {
    if (!this.#driverPath || !fs.existsSync(this.#driverPath)) {
      this.#driverPath = await ensureDriverInstalled({
        explicitPath: this.#config.driverPath
      });
    }
    fs.mkdirSync(this.#shotsDir, { recursive: true });
  }

  async call<T = any>(toolName: string, params: Record<string, unknown> = {}, options: WorkerCallOptions = {}): Promise<T> {
    await this.ensureReady();

    if (!this.#driverPath) {
      throw new Error("CuaDriverUnavailable: cua-driver binary could not be found or installed");
    }

    if (options.signal?.aborted) {
      throw new Error("Aborted: call to " + toolName + " was aborted");
    }

    const payload = JSON.stringify(params);
    const timeoutMs = options.timeoutMs || 45000;

    return new Promise<T>((resolve, reject) => {
      let child: any = null;
      const onAbort = () => {
        try { child?.kill("SIGKILL"); } catch {}
        reject(new Error("Aborted: call to " + toolName + " was aborted"));
      };

      if (options.signal) {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      child = execFile(
        this.#driverPath!,
        ["call", toolName, payload],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 50 * 1024 * 1024
        },
        (err, stdout, stderr) => {
          if (options.signal) {
            options.signal.removeEventListener("abort", onAbort);
          }

          if (err) {
            const errDetail = (stderr || stdout || err.message).slice(0, 400);
            return reject(new Error("CuaToolError [" + toolName + "]: " + errDetail));
          }

          try {
            const trimmed = stdout.trim();
            if (!trimmed) {
              return resolve({} as T);
            }
            const res = JSON.parse(trimmed);
            resolve(res);
          } catch (parseErr: any) {
            reject(new Error("CuaParseError [" + toolName + "]: " + parseErr.message + " (output: " + stdout.slice(0, 150) + ")"));
          }
        }
      );
    });
  }

  async checkUpdate(): Promise<CuaUpdateInfo> {
    await this.ensureReady();
    return await checkDriverUpdate(this.#driverPath!);
  }

  async applyUpdate(): Promise<{ success: boolean; output: string }> {
    await this.ensureReady();
    return await applyDriverUpdate(this.#driverPath!);
  }

  dispose(): void {
  }

  restart(): void {
    this.#driverPath = resolveCuaDriverPath(this.#config.driverPath, this.#hostInfo);
  }
}
