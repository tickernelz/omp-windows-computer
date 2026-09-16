import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const PLUGIN_NAME = "@tickernelz/omp-windows-computer";

export type SettingType = "string" | "number" | "boolean" | "enum";

export interface WinSettingBase {
  type: SettingType;
  description: string;
}

export interface StringSetting extends WinSettingBase {
  type: "string";
  default: string;
}

export interface NumberSetting extends WinSettingBase {
  type: "number";
  default: number;
  min?: number;
  max?: number;
}

export interface BooleanSetting extends WinSettingBase {
  type: "boolean";
  default: boolean;
}

export interface EnumSetting extends WinSettingBase {
  type: "enum";
  values: string[];
  default: string;
}

export type WinSetting = StringSetting | NumberSetting | BooleanSetting | EnumSetting;

export const SCHEMA: Record<string, WinSetting> = {
  driverPath: { type: "string", default: "", description: "Explicit path to cua-driver.exe; empty uses auto-discovery/auto-download" },
  autoUpdate: { type: "boolean", default: true, description: "Automatically check and update cua-driver on launch" },
  maxWidth: { type: "number", default: 3840, min: 640, max: 7680, description: "Screenshot downscale width ceiling in pixels" },
  maxHeight: { type: "number", default: 2400, min: 480, max: 4320, description: "Screenshot downscale height ceiling in pixels" },
  imageFormat: { type: "enum", values: ["png", "jpeg"], default: "png", description: "Screenshot encoding returned to the model" },
  callTimeoutMs: { type: "number", default: 45000, min: 1000, max: 300000, description: "RPC call deadline in milliseconds" }
};

export interface WinComputerConfig {
  driverPath: string;
  autoUpdate: boolean;
  maxWidth: number;
  maxHeight: number;
  imageFormat: "png" | "jpeg";
  callTimeoutMs: number;
}

export function getDefaultConfig(): WinComputerConfig {
  const defaults: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(SCHEMA)) {
    defaults[k] = s.default;
  }
  return defaults as unknown as WinComputerConfig;
}

export function getPluginsLockfilePath(): string {
  return path.join(os.homedir(), ".omp", "plugins", "omp-plugins.lock.json");
}

export function getProjectOverridesPath(cwd: string): string {
  return path.join(cwd, ".omp", "plugin-overrides.json");
}

export function validateSetting(key: string, rawValue: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = SCHEMA[key];
  if (!schema) {
    return { ok: false, error: "Unknown configuration key \"" + key + "\". Run /win-computer to list keys." };
  }

  if (schema.type === "boolean") {
    if (typeof rawValue === "boolean") return { ok: true, value: rawValue };
    const str = String(rawValue).trim().toLowerCase();
    if (str === "true" || str === "on" || str === "1" || str === "yes") return { ok: true, value: true };
    if (str === "false" || str === "off" || str === "0" || str === "no") return { ok: true, value: false };
    return { ok: false, error: "Invalid " + key + " \"" + rawValue + "\". Use on or off." };
  }

  if (schema.type === "number") {
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (isNaN(num)) {
      return { ok: false, error: "Invalid " + key + " \"" + rawValue + "\". Expected a number." };
    }
    if (schema.min !== undefined && num < schema.min) {
      return { ok: false, error: "Invalid " + key + " \"" + rawValue + "\". Allowed: " + schema.min + " - " + (schema.max ?? "infinity") };
    }
    if (schema.max !== undefined && num > schema.max) {
      return { ok: false, error: "Invalid " + key + " \"" + rawValue + "\". Allowed: " + (schema.min ?? "-infinity") + " - " + schema.max };
    }
    return { ok: true, value: num };
  }

  if (schema.type === "enum") {
    const str = String(rawValue).trim().toLowerCase();
    if (schema.values.includes(str)) {
      return { ok: true, value: str };
    }
    return { ok: false, error: "Invalid " + key + " \"" + rawValue + "\". Options: " + schema.values.join(", ") };
  }

  if (schema.type === "string") {
    return { ok: true, value: String(rawValue).trim() };
  }

  return { ok: false, error: "Unsupported setting type for \"" + key + "\"" };
}

export function loadConfig(cwd: string = process.cwd()): WinComputerConfig {
  const effective = getDefaultConfig() as unknown as Record<string, unknown>;

  const globalLock = getPluginsLockfilePath();
  try {
    if (fs.existsSync(globalLock)) {
      const data = JSON.parse(fs.readFileSync(globalLock, "utf8"));
      const pluginSettings = data?.settings?.[PLUGIN_NAME];
      if (pluginSettings && typeof pluginSettings === "object") {
        for (const [k, v] of Object.entries(pluginSettings)) {
          const val = validateSetting(k, v);
          if (val.ok) effective[k] = val.value;
        }
      }
    }
  } catch {}

  const projectOverrides = getProjectOverridesPath(cwd);
  try {
    if (fs.existsSync(projectOverrides)) {
      const data = JSON.parse(fs.readFileSync(projectOverrides, "utf8"));
      const pluginSettings = data?.settings?.[PLUGIN_NAME];
      if (pluginSettings && typeof pluginSettings === "object") {
        for (const [k, v] of Object.entries(pluginSettings)) {
          const val = validateSetting(k, v);
          if (val.ok) effective[k] = val.value;
        }
      }
    }
  } catch {}

  return effective as unknown as WinComputerConfig;
}

export function saveSetting(key: string, rawValue: unknown, lockfilePath: string = getPluginsLockfilePath()): { ok: true; value: unknown } | { ok: false; error: string } {
  const validated = validateSetting(key, rawValue);
  if (!validated.ok) return validated;

  const dir = path.dirname(lockfilePath);
  fs.mkdirSync(dir, { recursive: true });

  let lockData: any = { plugins: {}, settings: {} };
  try {
    if (fs.existsSync(lockfilePath)) {
      lockData = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
    }
  } catch {}

  if (!lockData.settings) lockData.settings = {};
  if (!lockData.settings[PLUGIN_NAME]) lockData.settings[PLUGIN_NAME] = {};

  lockData.settings[PLUGIN_NAME][key] = validated.value;

  const tmpPath = lockfilePath + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(lockData, null, 2) + "\n", { encoding: "utf8" });
  fs.renameSync(tmpPath, lockfilePath);

  return validated;
}

export function resetSettings(lockfilePath: string = getPluginsLockfilePath()): void {
  if (!fs.existsSync(lockfilePath)) return;
  try {
    const lockData = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
    if (lockData.settings && lockData.settings[PLUGIN_NAME]) {
      delete lockData.settings[PLUGIN_NAME];
      const tmpPath = lockfilePath + ".tmp-" + process.pid + "-" + Date.now();
      fs.writeFileSync(tmpPath, JSON.stringify(lockData, null, 2) + "\n", { encoding: "utf8" });
      fs.renameSync(tmpPath, lockfilePath);
    }
  } catch {}
}
