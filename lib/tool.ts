import * as fs from "node:fs";
import * as path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { WindowsWorker } from "./worker-client.ts";
import { ComputerDesktop } from "./desktop.ts";

export const WinComputerToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("run"),
    code: Type.Optional(Type.String({ description: "JavaScript executed in the desktop session; desktop, wait, assert, args in scope" })),
    fn: Type.Optional(Type.String({ description: "Serialized function string receiving ({ desktop, wait, assert }, ...args)" })),
    args: Type.Optional(Type.Array(Type.Unknown(), { description: "Positional function arguments" })),
    read_only: Type.Optional(Type.Boolean({ description: "true = desktop inspection only (screenshots, ax, reads); input mutation blocked" })),
    timeout: Type.Optional(Type.Number({ description: "Run budget in seconds" }))
  }),
  Type.Object({
    action: Type.Literal("call"),
    chain: Type.Array(
      Type.Object({
        method: Type.String({ description: "Method name to invoke" }),
        args: Type.Array(Type.Unknown(), { description: "Method arguments" })
      }),
      { description: "Desktop helper invocation with at most one window/element handle hop" }
    ),
    timeout: Type.Optional(Type.Number({ description: "Run budget in seconds" }))
  }),
  Type.Object({
    action: Type.Literal("raw"),
    tool: Type.String({ description: "Direct cua-driver native tool name (e.g. list_apps, kill_app, get_screen_size, set_config)" }),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Parameters passed to cua-driver native tool" })),
    timeout: Type.Optional(Type.Number({ description: "Run budget in seconds" }))
  }),
  Type.Object({
    action: Type.Literal("capabilities")
  }),
  Type.Object({
    action: Type.Literal("close")
  })
]);

export type WinComputerParams = Static<typeof WinComputerToolSchema>;

const READ_METHODS = new Set([
  "capabilities",
  "displays",
  "windows",
  "window",
  "focusedWindow",
  "screenshot",
  "apps",
  "elementAt",
  "focusedElement",
  "ref",
  "clipboard.read",
  "ax",
  "find",
  "value",
  "bounds",
  "attributes",
  "actions",
  "parent",
  "children"
]);

export function winComputerApproval(params: WinComputerParams): "read" | "exec" {
  if (params.action === "capabilities" || params.action === "close") {
    return "read";
  }
  if (params.action === "run") {
    return params.read_only === true ? "read" : "exec";
  }
  if (params.action === "call") {
    if (!params.chain || !Array.isArray(params.chain)) return "exec";
    const allRead = params.chain.every((step) => READ_METHODS.has(step.method));
    return allRead ? "read" : "exec";
  }
  if (params.action === "raw") {
    const rawTool = (params as any).tool;
    if (rawTool === "list_windows" || rawTool === "list_apps" || rawTool === "get_screen_size" || rawTool === "check_permissions" || rawTool === "get_desktop_state") {
      return "read";
    }
    return "exec";
  }
  return "exec";
}

export function createWinComputerTool(worker: WindowsWorker): ToolDefinition<typeof WinComputerToolSchema> {
  return {
    name: "win_computer",
    label: "Windows (Cua-Driver Engine)",
    description: "Control the host Windows desktop from WSL2 powered by trycua/cua native driver:\\n" +
      "- Multi-Monitor Geometry: desktop.displays(), desktop.screenshot({ display: 'primary' })\\n" +
      "- Window Lifecycle: desktop.windows(), desktop.launch('chrome.exe'), win.raise(), win.setFrame(x, y, w, h)\\n" +
      "- App Management: desktop.apps() (lists running and installed apps), desktop.kill(pid)\\n" +
      "- Full UI Automation & Menu: win.ax(), win.find({ role: 'button' }), win.invokeMenu(['File', 'Save']), el.click()\\n" +
      "- High-Fidelity Input: win.type('text') (auto-routes UIA ValuePattern on Windows 11 XAML apps without character drops), win.press(['ctrl', 'l'])\\n" +
      "- Direct Cua Tool Passthrough: { action: 'raw', tool: 'list_apps', params: {} }\\n" +
      "- Multi-step scripting: { action: 'run', code: '...' } with { desktop, wait, assert } in scope.",
    parameters: WinComputerToolSchema,
    strict: true,
    approval: (params: unknown) => winComputerApproval(params as WinComputerParams),
    execute: async (toolCallId, params, signal, onUpdate, ctx): Promise<AgentToolResult> => {
      if (params.action === "capabilities") {
        const desktop = new ComputerDesktop(worker, true);
        const caps = await desktop.capabilities();
        return {
          content: [{ type: "text", text: JSON.stringify(caps, null, 2) }],
          details: caps
        };
      }

      if (params.action === "close") {
        worker.dispose();
        return {
          content: [{ type: "text", text: "Closed Windows desktop session" }],
          details: { closed: true }
        };
      }

      if (params.action === "raw") {
        const toolName = (params as any).tool;
        const toolParams = (params as any).params || {};
        const res = await worker.call(toolName, toolParams, {
          timeoutMs: params.timeout ? params.timeout * 1000 : undefined
        });
        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
          details: res
        };
      }

      if (params.action === "call") {
        const chain = params.chain;
        if (!chain || chain.length === 0) {
          throw new Error("Action 'call' requires a non-empty 'chain'.");
        }
        if (chain.length > 2) {
          throw new Error("Call chains support one handle hop at most; use action 'run' for longer sequences.");
        }

        const readOnly = winComputerApproval(params) === "read";
        const desktop = new ComputerDesktop(worker, readOnly);
        desktop.clearRecordedScreenshots();

        let target: any = desktop;
        for (let i = 0; i < chain.length; i++) {
          const step = chain[i];
          const fn = target[step.method];
          if (typeof fn !== "function") {
            throw new Error("Unknown desktop/window/element method: " + step.method);
          }
          target = await fn.apply(target, step.args || []);
        }

        const images = await collectScreenshotImages(desktop.recordedScreenshots);
        const textOut = target !== undefined ? JSON.stringify(target, null, 2) : "ok";
        return {
          content: [{ type: "text", text: textOut }, ...images],
          details: { value: target, screenshots: desktop.recordedScreenshots }
        };
      }

      if (params.action === "run") {
        const readOnly = params.read_only === true;
        const desktop = new ComputerDesktop(worker, readOnly);
        desktop.clearRecordedScreenshots();

        let codeToRun = params.code?.trim() || "";
        if (params.fn?.trim()) {
          codeToRun = "return await (" + params.fn.trim() + ")({ desktop, wait, assert }, ...(args || []));";
        }

        if (!codeToRun) {
          throw new Error("Action 'run' requires exactly one of 'code' or 'fn'.");
        }

        const wait = async (msOrPredicate: number | (() => unknown), opts: { timeout?: number; interval?: number } = {}) => {
          if (typeof msOrPredicate === "number") {
            await new Promise((r) => setTimeout(r, msOrPredicate));
            return;
          }
          const timeout = opts.timeout || 10000;
          const interval = opts.interval || 200;
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const res = await msOrPredicate();
            if (res) return res;
            await new Promise((r) => setTimeout(r, interval));
          }
          throw new Error("WaitTimeout: predicate did not return truthy within " + timeout + "ms");
        };

        const assert = (condition: unknown, message?: string) => {
          if (!condition) {
            throw new Error(message || "Assertion failed in computer run script");
          }
        };

        const AsyncFunction = (async function () {}).constructor as any;
        const executor = new AsyncFunction("desktop", "wait", "assert", "args", codeToRun);

        const val = await executor(desktop, wait, assert, params.args || []);
        const images = await collectScreenshotImages(desktop.recordedScreenshots);
        const textOut = val !== undefined ? JSON.stringify(val, null, 2) : "ok";

        return {
          content: [{ type: "text", text: textOut }, ...images],
          details: { value: val, screenshots: desktop.recordedScreenshots, readOnly }
        };
      }

      throw new Error("Unknown action: " + (params as any).action);
    }
  };
}

async function collectScreenshotImages(paths: readonly string[]): Promise<Array<{ type: "image"; data: string; mimeType: string; detail: "original" }>> {
  const images: Array<{ type: "image"; data: string; mimeType: string; detail: "original" }> = [];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const ext = path.extname(p).toLowerCase();
        const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        images.push({
          type: "image",
          data: buf.toString("base64"),
          mimeType,
          detail: "original"
        });
      }
    } catch {}
  }
  return images;
}
