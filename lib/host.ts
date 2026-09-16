import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type HostKind = "wsl" | "win32";

export interface HostInfo {
  kind: HostKind;
  shellPath: string;
  toWindowsPath: (posixOrWinPath: string) => string;
  toHostPath: (winOrPosixPath: string) => string;
  tempDirHost: string;
  tempDirWindows: string;
  systemRootWindows: string;
  programFilesWindows: string;
}

export interface DriveMapping {
  drive: string;
  mountPoint: string;
}

let cachedHostInfo: HostInfo | null = null;

export function parseDrvfsMounts(mountsContent: string): DriveMapping[] {
  const mappings: DriveMapping[] = [];
  const lines = mountsContent.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const mountPoint = parts[1];
    const options = parts[3];
    if (options.includes("aname=drvfs")) {
      const match = options.match(/path=([A-Za-z]):\\/);
      if (match) {
        mappings.push({ drive: match[1].toUpperCase(), mountPoint });
      }
    }
  }
  return mappings;
}

export function buildPathTranslators(mappings: DriveMapping[]): {
  toWindowsPath: (posixPath: string) => string;
  toHostPath: (winPath: string) => string;
} {
  const sortedByLen = [...mappings].sort((a, b) => b.mountPoint.length - a.mountPoint.length);

  const toWindowsPath = (posixPath: string): string => {
    const normalized = posixPath.replace(/\\/g, "/");
    for (const m of sortedByLen) {
      if (normalized === m.mountPoint || normalized.startsWith(m.mountPoint + "/")) {
        const sub = normalized.slice(m.mountPoint.length).replace(/^\//, "");
        const winSub = sub ? sub.replace(/\//g, "\\") : "";
        return `${m.drive}:\\${winSub}`;
      }
    }
    const directWinMatch = posixPath.match(/^([A-Za-z]):[\\/](.*)/);
    if (directWinMatch) {
      return `${directWinMatch[1].toUpperCase()}:\\${directWinMatch[2].replace(/\//g, "\\")}`;
    }
    throw new Error(`DriveNotMounted: path "${posixPath}" cannot be mapped to a Windows drive`);
  };

  const toHostPath = (winPath: string): string => {
    const match = winPath.match(/^([A-Za-z]):[\\/](.*)/);
    if (!match) {
      if (winPath.startsWith("/")) return winPath;
      throw new Error(`DriveNotMounted: invalid Windows path "${winPath}"`);
    }
    const driveLetter = match[1].toUpperCase();
    const rel = match[2].replace(/\\/g, "/");
    const m = mappings.find((item) => item.drive === driveLetter);
    if (!m) {
      throw new Error(`DriveNotMounted: drive "${driveLetter}:" is not mounted in this WSL distro`);
    }
    return path.posix.join(m.mountPoint, rel);
  };

  return { toWindowsPath, toHostPath };
}

export function isWslEnvironment(): boolean {
  if (process.platform === "win32") return false;
  try {
    const osrelease = fs.readFileSync("/proc/sys/kernel/osrelease", "utf8").toLowerCase();
    return osrelease.includes("microsoft") || osrelease.includes("wsl");
  } catch {
    return false;
  }
}

export function verifyWslInterop(): boolean {
  try {
    const binfmtPaths = ["/proc/sys/fs/binfmt_misc/WSLInterop", "/proc/sys/fs/binfmt_misc/WSLInterop-late"];
    for (const p of binfmtPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8").toLowerCase();
        if (content.includes("enabled")) return true;
      }
    }
  } catch {}
  return false;
}

export function resolveHost(options: { explicitShellPath?: string; shellPreference?: "auto" | "ps5" | "pwsh7"; forceRefresh?: boolean } = {}): HostInfo {
  if (cachedHostInfo && !options.forceRefresh) {
    return cachedHostInfo;
  }

  if (process.platform === "win32") {
    const shellPath = options.explicitShellPath || (process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe");
    const tempDirWindows = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Temp", "omp-windows-computer") : path.join(process.env.TEMP || "C:\\Temp", "omp-windows-computer");
    cachedHostInfo = {
      kind: "win32",
      shellPath,
      toWindowsPath: (p: string) => path.win32.normalize(p),
      toHostPath: (p: string) => path.win32.normalize(p),
      tempDirHost: tempDirWindows,
      tempDirWindows,
      systemRootWindows: process.env.SystemRoot || "C:\\Windows",
      programFilesWindows: process.env.ProgramFiles || "C:\\Program Files"
    };
    return cachedHostInfo;
  }

  if (!isWslEnvironment()) {
    throw new Error("WindowsUnavailable: this plugin requires WSL with Windows interop, or OMP running natively on Windows");
  }

  if (!verifyWslInterop()) {
    throw new Error("WindowsUnavailable: WSL interop is disabled (binfmt_misc WSLInterop not enabled)");
  }

  let mappings: DriveMapping[] = [];
  try {
    const mounts = fs.readFileSync("/proc/mounts", "utf8");
    mappings = parseDrvfsMounts(mounts);
  } catch (err) {
    throw new Error(`WindowsUnavailable: failed to read /proc/mounts: ${err}`);
  }

  if (mappings.length === 0) {
    if (fs.existsSync("/mnt/c")) {
      mappings.push({ drive: "C", mountPoint: "/mnt/c" });
    } else {
      throw new Error("WindowsUnavailable: no drvfs Windows drive mounts found in /proc/mounts");
    }
  }

  const { toWindowsPath, toHostPath } = buildPathTranslators(mappings);

  const candidateShells: string[] = [];
  if (options.explicitShellPath) {
    candidateShells.push(options.explicitShellPath);
  } else {
    const pref = options.shellPreference || "auto";
    const cMount = mappings.find((m) => m.drive === "C")?.mountPoint || "/mnt/c";
    const ps5 = path.posix.join(cMount, "Windows/System32/WindowsPowerShell/v1.0/powershell.exe");
    const pwsh7 = path.posix.join(cMount, "Program Files/PowerShell/7/pwsh.exe");

    if (pref === "ps5") {
      candidateShells.push(ps5);
    } else if (pref === "pwsh7") {
      candidateShells.push(pwsh7);
    } else {
      candidateShells.push(ps5, pwsh7);
    }
  }

  let activeShell: string | null = null;
  let probeOutput = "";
  for (const shell of candidateShells) {
    try {
      if (fs.existsSync(shell)) {
        const probeCmd = "$env:LOCALAPPDATA + '|' + $env:SystemRoot + '|' + $env:ProgramFiles";
        const out = execFileSync(shell, ["-NoProfile", "-NonInteractive", "-Command", probeCmd], {
          encoding: "utf8",
          timeout: 5000
        }).trim();
        if (out && out.includes("|")) {
          activeShell = shell;
          probeOutput = out;
          break;
        }
      }
    } catch {}
  }

  if (!activeShell) {
    throw new Error(`WindowsUnavailable: powershell.exe not found or failed to execute. Candidates attempted: ${candidateShells.join(", ")}`);
  }

  const [localAppDataWin, sysRootWin, progFilesWin] = probeOutput.split("|");
  const tempDirWindows = `${localAppDataWin}\\Temp\\omp-windows-computer`;
  const tempDirHost = toHostPath(tempDirWindows);

  cachedHostInfo = {
    kind: "wsl",
    shellPath: activeShell,
    toWindowsPath,
    toHostPath,
    tempDirHost,
    tempDirWindows,
    systemRootWindows: sysRootWin || "C:\\Windows",
    programFilesWindows: progFilesWin || "C:\\Program Files"
  };

  return cachedHostInfo;
}
