import type { ExtensionCommandContext, RegisteredCommand } from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { SCHEMA, loadConfig, saveSetting, resetSettings, validateSetting, type WinComputerConfig } from "./config.ts";
import { WindowsWorker } from "./worker-client.ts";
import { ComputerDesktop } from "./desktop.ts";
import { ensureDriverInstalled } from "./driver-manager.ts";

export function formatSettingsOverview(config: WinComputerConfig): string {
  const lines = [
    "Windows Computer Bridge Settings (/win-computer):",
    ""
  ];

  for (const [k, s] of Object.entries(SCHEMA)) {
    const val = (config as any)[k];
    const extra = s.type === "enum" ? " [" + (s as any).values.join(" | ") + "]" : s.type === "number" ? " (" + (s.min ?? "") + "-" + (s.max ?? "") + ")" : "";
    lines.push("• " + k + ": " + JSON.stringify(val) + extra);
    lines.push("  " + s.description);
  }

  lines.push("");
  lines.push("Usage:");
  lines.push("  /win-computer                  Open interactive TUI settings menu");
  lines.push("  /win-computer <key> <value>    Update a setting directly");
  lines.push("  /win-computer update           Check for and apply cua-driver update");
  lines.push("  /win-computer install          Download & install cua-driver if missing");
  lines.push("  /win-computer apps             List installed and running Windows apps");
  lines.push("  /win-computer kill <pid>       Force-terminate a process by PID");
  lines.push("  /win-computer doctor           Run end-to-end host & driver diagnostics");
  lines.push("  /win-computer status           Show current connection & driver status");
  lines.push("  /win-computer windows          List active Windows host top-level windows");
  lines.push("  /win-computer reset            Reset all settings to defaults");

  return lines.join("\n");
}

export function getWinComputerCompletions(prefix: string): AutocompleteItem[] {
  const trimmed = prefix.trimStart();
  const tokens = trimmed.split(/\s+/);

  const subcommands: AutocompleteItem[] = [
    { value: "doctor", label: "doctor", description: "Run driver diagnostics and permissions check" },
    { value: "update", label: "update", description: "Check for and apply cua-driver updates" },
    { value: "install", label: "install", description: "Download and install cua-driver on Windows host" },
    { value: "apps", label: "apps", description: "List installed and running Windows applications" },
    { value: "kill", label: "kill", description: "Force-terminate a process by PID" },
    { value: "status", label: "status", description: "Display bridge status and driver details" },
    { value: "windows", label: "windows", description: "List open Windows host windows" },
    { value: "reset", label: "reset", description: "Reset all bridge configuration settings to default" }
  ];

  const configKeys: AutocompleteItem[] = Object.entries(SCHEMA).map(([k, s]) => ({
    value: k,
    label: k,
    description: s.description
  }));

  const allFirst = [...subcommands, ...configKeys];

  if (tokens.length <= 1) {
    const filter = (tokens[0] || "").toLowerCase();
    return allFirst.filter((item) => item.value.toLowerCase().startsWith(filter));
  }

  const key = tokens[0];
  const schema = SCHEMA[key];
  if (!schema) return [];

  const valFilter = (tokens[1] || "").toLowerCase();

  if (schema.type === "enum") {
    return schema.values
      .filter((v) => v.toLowerCase().startsWith(valFilter))
      .map((v) => ({ value: key + " " + v, label: v }));
  }

  if (schema.type === "boolean") {
    return ["on", "off"]
      .filter((v) => v.startsWith(valFilter))
      .map((v) => ({ value: key + " " + v, label: v }));
  }

  return [];
}

export async function runDoctor(ctx: ExtensionCommandContext, worker: WindowsWorker): Promise<void> {
  const lines: string[] = ["=== Windows Bridge Doctor (cua-driver) ==="];

  try {
    const host = worker.hostInfo;
    lines.push("✔ Host kind: " + host.kind);
    lines.push("✔ Windows Temp: " + host.tempDirWindows);
  } catch (err: any) {
    lines.push("✖ Host resolution failed: " + err.message);
    ctx.ui?.notify?.(lines.join("\n"), "error");
    return;
  }

  try {
    const driver = worker.driverPath;
    lines.push("✔ cua-driver binary: " + (driver || "not found"));

    if (driver) {
      const up = await worker.checkUpdate();
      lines.push("✔ Version: " + up.currentVersion + (up.updateAvailable ? " (update available: " + up.latestVersion + ")" : " (up-to-date)"));
    }
  } catch (err: any) {
    lines.push("✖ Driver check warning: " + err.message);
  }

  try {
    const desktop = new ComputerDesktop(worker);
    const caps = await desktop.capabilities();
    lines.push("✔ Capabilities: backend=" + caps.backend + ", displays=" + caps.displayCount);

    const windows = await desktop.windows();
    lines.push("✔ Windows detected: " + windows.length + " window(s) open");

    lines.push("\nAll diagnostics passed! Cua-driver bridge is ready.");
    ctx.ui?.notify?.(lines.join("\n"), "info");
  } catch (err: any) {
    lines.push("✖ Diagnostic failed: " + err.message);
    ctx.ui?.notify?.(lines.join("\n"), "error");
  }
}

export function createWinComputerCommand(worker: WindowsWorker): RegisteredCommand {
  return {
    name: "win-computer",
    description: "View and adjust Windows computer bridge settings, manage cua-driver, or list windows.",
    getArgumentCompletions: (prefix: string) => getWinComputerCompletions(prefix),
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const trimmed = args.trim();

      if (!trimmed) {
        ctx.ui?.notify?.(formatSettingsOverview(loadConfig(ctx.cwd)), "info");
        return;
      }

      const [first, ...rest] = trimmed.split(/\s+/);
      const sub = first.toLowerCase();

      if (sub === "doctor") {
        await runDoctor(ctx, worker);
        return;
      }

      if (sub === "apps") {
        try {
          const desktop = new ComputerDesktop(worker);
          const apps = await desktop.apps();
          const running = apps.filter((a) => a.running);
          const installed = apps.filter((a) => !a.running);
          const msg = [
            "Windows Applications (" + apps.length + " total):",
            "• Running (" + running.length + "): " + running.map((a) => a.name + (a.pid ? " (pid=" + a.pid + ")" : "")).slice(0, 15).join(", "),
            "• Installed (" + installed.length + "): " + installed.map((a) => a.name).slice(0, 15).join(", ")
          ].join("\n");
          ctx.ui?.notify?.(msg, "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Failed to list apps: " + err.message, "error");
        }
        return;
      }

      if (sub === "kill") {
        const targetPid = parseInt(rest[0] || "", 10);
        if (!targetPid || isNaN(targetPid)) {
          ctx.ui?.notify?.("Usage: /win-computer kill <pid>", "error");
          return;
        }
        try {
          const desktop = new ComputerDesktop(worker);
          await desktop.kill(targetPid);
          ctx.ui?.notify?.("✔ Process PID " + targetPid + " terminated.", "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Failed to kill process: " + err.message, "error");
        }
        return;
      }

      if (sub === "update") {
        try {
          ctx.ui?.notify?.("Checking for cua-driver updates...", "info");
          const up = await worker.checkUpdate();
          if (!up.updateAvailable) {
            ctx.ui?.notify?.("cua-driver is already up-to-date (" + up.currentVersion + ").", "info");
            return;
          }
          ctx.ui?.notify?.("Applying update to " + up.latestVersion + "...", "info");
          const res = await worker.applyUpdate();
          ctx.ui?.notify?.("cua-driver updated successfully to " + up.latestVersion + "!\n" + res.output, "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Update failed: " + err.message, "error");
        }
        return;
      }

      if (sub === "install") {
        try {
          await ensureDriverInstalled({
            onProgress: (m) => ctx.ui?.notify?.(m, "info")
          });
          worker.restart();
          ctx.ui?.notify?.("cua-driver installed and ready!", "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Install failed: " + err.message, "error");
        }
        return;
      }

      if (sub === "status") {
        try {
          const host = worker.hostInfo;
          const desktop = new ComputerDesktop(worker);
          const windows = await desktop.windows();
          const msg = [
            "Windows Bridge Status (cua-driver):",
            "• Host: " + host.kind,
            "• Driver binary: " + (worker.driverPath || "unresolved"),
            "• Open Windows: " + windows.length
          ].join("\n");
          ctx.ui?.notify?.(msg, "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Status check failed: " + err.message, "error");
        }
        return;
      }

      if (sub === "windows") {
        try {
          const desktop = new ComputerDesktop(worker);
          const list = await desktop.windows();
          const rows = list.slice(0, 40).map((w) => "• [" + w.id + "] pid=" + w.pid + ": \"" + w.title + "\" (" + w.width + "x" + w.height + " @ " + w.x + "," + w.y + ")");
          const header = "Open Windows (" + list.length + " total):\n";
          ctx.ui?.notify?.(header + rows.join("\n"), "info");
        } catch (err: any) {
          ctx.ui?.notify?.("Failed to list windows: " + err.message, "error");
        }
        return;
      }

      if (sub === "reset") {
        const ok = await ctx.ui?.confirm?.("win-computer", "Reset all Windows bridge settings to defaults?");
        if (ok) {
          resetSettings();
          worker.restart();
          ctx.ui?.notify?.("Windows bridge settings reset to default.", "info");
        }
        return;
      }

      if (SCHEMA[sub]) {
        const valStr = rest.join(" ").trim();
        if (!valStr) {
          const cfg = loadConfig(ctx.cwd);
          ctx.ui?.notify?.(sub + " is currently set to: " + JSON.stringify((cfg as any)[sub]), "info");
          return;
        }
        const res = saveSetting(sub, valStr);
        if (res.ok) {
          if (sub === "driverPath") {
            worker.restart();
          }
          ctx.ui?.notify?.("✔ Updated " + sub + " to \"" + String(res.value) + "\"", "info");
        } else {
          ctx.ui?.notify?.(res.error, "error");
        }
        return;
      }

      ctx.ui?.notify?.("Unknown /win-computer subcommand or key \"" + sub + "\". Run /win-computer for help.", "error");
    }
  };
}
