import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { resolveHost, type HostInfo } from "./host.ts";

export interface CuaUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  installCommand?: string;
  releaseNotesUrl?: string;
}

export function resolveCuaDriverPath(explicitPath?: string, hostInfo?: HostInfo): string | null {
  const host = hostInfo || resolveHost();

  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  const hermesEnv = process.env.HERMES_CUA_DRIVER_CMD;
  if (hermesEnv && fs.existsSync(hermesEnv)) {
    return hermesEnv;
  }

  if (host.kind === "win32") {
    const localApp = process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local";
    const standardWin = path.join(localApp, "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe");
    if (fs.existsSync(standardWin)) return standardWin;
  } else {
    try {
      const localAppWin = host.tempDirWindows.replace(/[\\\/]Temp[\\\/]omp-windows-computer$/i, "");
      const standardWinPath = localAppWin + "\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe";
      const standardHostPath = host.toHostPath(standardWinPath);
      if (fs.existsSync(standardHostPath)) {
        return standardHostPath;
      }
    } catch {}

    try {
      const cMount = host.toHostPath("C:\\");
      const usersDir = path.join(cMount, "Users");
      if (fs.existsSync(usersDir)) {
        for (const u of fs.readdirSync(usersDir)) {
          const cand = path.join(usersDir, u, "AppData", "Local", "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe");
          if (fs.existsSync(cand)) return cand;
        }
      }
    } catch {}
  }

  try {
    const whichCmd = host.kind === "win32" ? "where.exe" : "which";
    const found = execFileSync(whichCmd, ["cua-driver.exe"], { encoding: "utf8" }).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {}

  return null;
}

export async function ensureDriverInstalled(options: { explicitPath?: string; onProgress?: (msg: string) => void } = {}): Promise<string> {
  const existing = resolveCuaDriverPath(options.explicitPath);
  if (existing) return existing;

  options.onProgress?.("cua-driver not found on Windows host. Downloading and installing via official installer...");

  const host = resolveHost();
  const installCmd = "irm https://cua.ai/driver/install.ps1 | iex";

  if (host.kind === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", installCmd], {
      stdio: "inherit"
    });
  } else {
    execFileSync(host.shellPath, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", installCmd], {
      stdio: "inherit"
    });
  }

  const resolved = resolveCuaDriverPath(options.explicitPath);
  if (!resolved) {
    throw new Error("CuaInstallFailed: installation command finished, but cua-driver.exe could not be found at standard location.");
  }

  options.onProgress?.("cua-driver installed successfully at " + resolved);
  return resolved;
}

export async function checkDriverUpdate(driverPath: string): Promise<CuaUpdateInfo> {
  return new Promise((resolve, reject) => {
    execFile(driverPath, ["check-update", "--json"], { encoding: "utf8", timeout: 15000 }, (err, stdout) => {
      if (err) {
        return reject(new Error("CuaUpdateCheckFailed: " + err.message));
      }
      try {
        const data = JSON.parse(stdout.trim());
        resolve({
          updateAvailable: Boolean(data.update_available),
          currentVersion: data.current_version || "unknown",
          latestVersion: data.latest_version || "unknown",
          installCommand: data.install_command,
          releaseNotesUrl: data.release_notes_url
        });
      } catch (parseErr: any) {
        reject(new Error("CuaUpdateCheckParseError: " + parseErr.message));
      }
    });
  });
}

export async function applyDriverUpdate(driverPath: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(driverPath, ["update", "--apply"], { encoding: "utf8", timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error("CuaUpdateApplyFailed: " + err.message + ". Stderr: " + stderr));
      }
      resolve({
        success: true,
        output: (stdout + "\n" + stderr).trim()
      });
    });
  });
}
