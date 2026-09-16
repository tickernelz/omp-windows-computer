import type { ExtensionCommandContext, RegisteredCommand } from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { SCHEMA, loadConfig, saveSetting, resetSettings, validateSetting, type WinComputerConfig } from "./config.ts";
import { WindowsWorker } from "./worker-client.ts";
import { ComputerDesktop } from "./desktop.ts";

export function formatSettingsOverview(config: WinComputerConfig): string {
  const lines = [
    "Windows Computer Bridge Settings (/win-computer):",
    ""
  ];

  for (const [k, s] of Object.entries(SCHEMA)) {
    const val = (config as any)[k];
    const extra = s.type === "enum" ? ` [${(s as any).values.join(" | ")}]` : s.type === "number" ? ` (${s.min ?? ""}-${s.max ?? ""})` : "";
    lines.push(`• ${k}: ${JSON.stringify(val)}${extra}`);
    lines.push(`  ${s.description}`);
  }

  lines.push("");
  lines.push("Usage:");
  lines.push("  /win-computer                  Open interactive TUI settings menu");
  lines.push("  /win-computer <key> <value>    Update a setting directly");
  lines.push("  /win-computer doctor           Run end-to-end host diagnostics");
  lines.push("  /win-computer status           Show current connection & worker status");
  lines.push("  /win-computer windows          List active Windows host top-level windows");
  lines.push("  /win-computer restart          Restart the background PowerShell worker");
  lines.push("  /win-computer reset            Reset all settings to defaults");

  return lines.join("\n");
}

export function getWinComputerCompletions(prefix: string): AutocompleteItem[] {
  const trimmed = prefix.trimStart();
  const tokens = trimmed.split(/\s+/);

  const subcommands: AutocompleteItem[] = [
    { value: "doctor", label: "doctor", description: "Run host connectivity, interop, and capture diagnostics" },
    { value: "status", label: "status", description: "Display bridge status and display/window counts" },
    { value: "windows", label: "windows", description: "List open Windows host windows" },
    { value: "restart", label: "restart", description: "Restart the persistent Windows PowerShell worker" },
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
      .map((v) => ({ value: `${key} ${v}`, label: v }));
  }

  if (schema.type === "boolean") {
    return ["on", "off"]
      .filter((v) => v.startsWith(valFilter))
      .map((v) => ({ value: `${key} ${v}`, label: v }));
  }

  if (key === "maxWidth") {
    return ["1280", "1920", "2560", "3840"]
      .filter((v) => v.startsWith(valFilter))
      .map((v) => ({ value: `${key} ${v}`, label: v }));
  }

  if (key === "maxHeight") {
    return ["896", "1080", "1440", "2400"]
      .filter((v) => v.startsWith(valFilter))
      .map((v) => ({ value: `${key} ${v}`, label: v }));
  }

  return [];
}

export async function openSettingsTui(ctx: ExtensionCommandContext, worker: WindowsWorker): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui" || !ctx.ui?.custom) {
    const cfg = loadConfig(ctx.cwd);
    ctx.ui?.notify?.(formatSettingsOverview(cfg), "info");
    return;
  }

  let tuiComponents: any;
  try {
    tuiComponents = await import("@oh-my-pi/pi-tui");
  } catch {
    ctx.ui?.notify?.(formatSettingsOverview(loadConfig(ctx.cwd)), "info");
    return;
  }

  const { SettingsList, Container, Text, Spacer } = tuiComponents;

  type SettingItem = {
    id: string;
    label: string;
    description?: string;
    currentValue: string;
    values?: string[];
  };

  await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: (res: void) => void) => {
    let cfg = loadConfig(ctx.cwd);

    const buildItems = (): SettingItem[] => {
      const items: SettingItem[] = [];
      for (const [k, s] of Object.entries(SCHEMA)) {
        const val = String((cfg as any)[k]);
        let values: string[] | undefined;
        if (s.type === "enum") values = s.values;
        else if (s.type === "boolean") values = ["true", "false"];
        else if (k === "maxWidth") values = ["1280", "1920", "2560", "3840"];
        else if (k === "maxHeight") values = ["896", "1080", "1440", "2400"];
        else if (k === "jpegQuality") values = ["60", "75", "82", "90", "100"];
        else if (k === "axMaxDepth") values = ["4", "8", "12", "24", "64"];
        else if (k === "axMaxNodes") values = ["200", "800", "2000", "20000"];

        items.push({
          id: k,
          label: k,
          description: s.description,
          currentValue: val,
          values
        });
      }
      return items;
    };

    const items = buildItems();
    const titleText = new Text(theme.bold(theme.fg("accent", "Windows Bridge Settings (/win-computer)")), 0, 0);
    const hintText = new Text(theme.fg("muted", "Enter / Space to cycle values · Type to filter · Esc to close"), 0, 0);
    const spacer = new Spacer(1);

    const onChange = async (id: string, newValue: string) => {
      let targetValue = newValue;
      const schema = SCHEMA[id];
      if (schema && (schema.type === "string" || !items.find((i) => i.id === id)?.values)) {
        const inputVal = await ctx.ui.input(`Enter ${id}`, targetValue);
        if (inputVal === undefined) return;
        targetValue = inputVal;
      }

      const res = saveSetting(id, targetValue);
      if (res.ok) {
        cfg = loadConfig(ctx.cwd);
        const item = items.find((it) => it.id === id);
        if (item) item.currentValue = String(res.value);
        if (id === "shell" || id === "shellPath") {
          worker.restart();
        }
      }
      tui.requestRender();
    };

    const settingsList = new SettingsList(
      items as any,
      Math.min(items.length, 14),
      {
        label: (t: string, sel: boolean) => (sel ? theme.bold(theme.fg("accent", t)) : t),
        value: (t: string, sel: boolean) => (sel ? theme.fg("accent", t) : theme.fg("muted", t)),
        description: (t: string) => theme.fg("muted", t),
        cursor: theme.fg("accent", "❯ "),
        hint: (t: string) => theme.fg("dim", t)
      },
      onChange,
      () => done(),
      { typeToSearch: true }
    );

    class WinSettingsRootComponent extends Container {
      settingsList: any;
      constructor(l: any) {
        super();
        this.settingsList = l;
        this.addChild(titleText);
        this.addChild(hintText);
        this.addChild(spacer);
        this.addChild(l);
      }
      handleInput(data: string): void {
        this.settingsList?.handleInput?.(data);
      }
      render(width: number): string[] {
        return (super.render as any)(width);
      }
    }

    return new WinSettingsRootComponent(settingsList);
  });

  ctx.ui?.notify?.("Windows bridge settings saved.", "info");
}

export async function runDoctor(ctx: ExtensionCommandContext, worker: WindowsWorker): Promise<void> {
  const lines: string[] = ["=== Windows Bridge Doctor ==="];

  try {
    const host = worker.hostInfo;
    lines.push(`✔ Host kind: ${host.kind}`);
    lines.push(`✔ Active shell: ${host.shellPath}`);
    lines.push(`✔ Temp directory (host): ${host.tempDirHost}`);
    lines.push(`✔ Temp directory (win): ${host.tempDirWindows}`);
  } catch (err: any) {
    lines.push(`✖ Host resolution failed: ${err.message}`);
    ctx.ui?.notify?.(lines.join("\n"), "error");
    return;
  }

  try {
    const t0 = Date.now();
    const ping = await worker.call("ping", {}, { idempotent: true, timeoutMs: 5000 });
    const dt = Date.now() - t0;
    lines.push(`✔ Worker handshake: ping round trip ${dt}ms`);
  } catch (err: any) {
    lines.push(`✖ Worker handshake failed: ${err.message}`);
    ctx.ui?.notify?.(lines.join("\n"), "error");
    return;
  }

  try {
    const desktop = new ComputerDesktop(worker);
    const caps = await desktop.capabilities();
    lines.push(`✔ Capabilities: backend=${caps.backend}, displays=${caps.displayCount}, ax=${caps.ax}`);

    const displays = await desktop.displays();
    lines.push(`✔ Displays resolved: ${displays.length} monitor(s) found`);

    const windows = await desktop.windows();
    lines.push(`✔ Windows detected: ${windows.length} window(s) currently open on host`);

    const tShot0 = Date.now();
    const shot = await desktop.screenshot({ silent: true });
    const shotDt = Date.now() - tShot0;
    lines.push(`✔ Screen capture: ${shot.width}x${shot.height} px in ${shotDt}ms (${shot.bytes} bytes)`);

    lines.push("\nAll diagnostics passed! Windows bridge is healthy.");
    ctx.ui?.notify?.(lines.join("\n"), "info");
  } catch (err: any) {
    lines.push(`✖ Diagnostic test failed: ${err.message}`);
    ctx.ui?.notify?.(lines.join("\n"), "error");
  }
}

export function createWinComputerCommand(worker: WindowsWorker): RegisteredCommand {
  return {
    name: "win-computer",
    description: "View and adjust Windows computer bridge settings, diagnose the host, or list windows.",
    getArgumentCompletions: (prefix: string) => getWinComputerCompletions(prefix),
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const trimmed = args.trim();

      if (!trimmed) {
        await openSettingsTui(ctx, worker);
        return;
      }

      const [first, ...rest] = trimmed.split(/\s+/);
      const sub = first.toLowerCase();

      if (sub === "doctor") {
        await runDoctor(ctx, worker);
        return;
      }

      if (sub === "status") {
        try {
          const host = worker.hostInfo;
          const desktop = new ComputerDesktop(worker);
          const caps = await desktop.capabilities();
          const windows = await desktop.windows();
          const msg = [
            "Windows Bridge Status:",
            `• Host: ${host.kind} (${host.shellPath})`,
            `• Worker process: ${worker.isAlive ? "active" : "idle"}`,
            `• Displays: ${caps.displayCount}`,
            `• Open Windows: ${windows.length}`,
            `• Staged Worker: ${worker.stagedScriptPath}`
          ].join("\n");
          ctx.ui?.notify?.(msg, "info");
        } catch (err: any) {
          ctx.ui?.notify?.(`Status check failed: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "windows") {
        try {
          const desktop = new ComputerDesktop(worker);
          const list = await desktop.windows();
          const rows = list.slice(0, 40).map((w) => `• [${w.id}] ${w.app}: "${w.title}" (${w.width}x${w.height} @ ${w.x},${w.y})`);
          const header = `Open Windows (${list.length} total):\n`;
          ctx.ui?.notify?.(header + rows.join("\n"), "info");
        } catch (err: any) {
          ctx.ui?.notify?.(`Failed to list windows: ${err.message}`, "error");
        }
        return;
      }

      if (sub === "restart") {
        worker.restart();
        ctx.ui?.notify?.("Windows worker restarted.", "info");
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
          ctx.ui?.notify?.(`${sub} is currently set to: ${JSON.stringify((cfg as any)[sub])}`, "info");
          return;
        }
        const res = saveSetting(sub, valStr);
        if (res.ok) {
          if (sub === "shell" || sub === "shellPath") {
            worker.restart();
          }
          ctx.ui?.notify?.(`✔ Updated ${sub} to "${String(res.value)}"`, "info");
        } else {
          ctx.ui?.notify?.(res.error, "error");
        }
        return;
      }

      ctx.ui?.notify?.(`Unknown /win-computer subcommand or key "${sub}". Type /win-computer for available options.`, "error");
    }
  };
}
