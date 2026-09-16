import * as path from "node:path";
import * as os from "node:os";
import { WindowsWorker } from "./worker-client.ts";
import { ComputerWindow, type ComputerWindowInfo, type ComputerWindowFilter, type ComputerBounds } from "./window.ts";
import { ComputerElement } from "./element.ts";

export interface ComputerDisplay extends ComputerBounds {
  id: string;
  name: string;
  scale: number;
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
  isPrimary: boolean;
}

export interface ComputerCapabilities {
  backend: string;
  displayServer?: string;
  capture: boolean;
  input: boolean;
  ax: boolean;
  backgroundWindowInput: boolean;
  deliveryModes: string[];
  capturePermission: string;
  inputPermission: string;
  axPermission: string;
  displayCount: number;
}

export interface ComputerScreenshotResult {
  path: string;
  width: number;
  height: number;
  bytes?: number;
}

export class ComputerDesktop {
  #worker: WindowsWorker;
  #readOnly: boolean;
  #screenshots: string[] = [];

  constructor(worker: WindowsWorker, readOnly: boolean = false) {
    this.#worker = worker;
    this.#readOnly = readOnly;
  }

  get isReadOnly(): boolean {
    return this.#readOnly;
  }

  get recordedScreenshots(): readonly string[] {
    return this.#screenshots;
  }

  clearRecordedScreenshots(): void {
    this.#screenshots = [];
  }

  #assertNotReadOnly(action: string): void {
    if (this.#readOnly) {
      throw new Error("ReadOnly: " + action + " is blocked by read_only: true");
    }
  }

  async capabilities(): Promise<ComputerCapabilities> {
    return await this.#worker.call<ComputerCapabilities>("capabilities", {}, { idempotent: true });
  }

  async displays(): Promise<ComputerDisplay[]> {
    return await this.#worker.call<ComputerDisplay[]>("displays", {}, { idempotent: true });
  }

  async windows(filter?: ComputerWindowFilter): Promise<ComputerWindowInfo[]> {
    const raw = await this.#worker.call<any[]>("windows", {}, { idempotent: true });
    let list: ComputerWindowInfo[] = raw.map((w) => ({
      id: w.id,
      app: w.app,
      title: w.title,
      pid: w.pid,
      bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      focused: w.focused
    }));

    if (filter) {
      if (filter.app) {
        const appL = filter.app.toLowerCase();
        list = list.filter((w) => w.app.toLowerCase().includes(appL));
      }
      if (filter.title) {
        const titleL = filter.title.toLowerCase();
        list = list.filter((w) => w.title.toLowerCase().includes(titleL));
      }
    }
    return list;
  }

  async window(selector: string | ComputerWindowFilter): Promise<ComputerWindow> {
    const all = await this.windows();
    let matches: ComputerWindowInfo[] = [];

    if (typeof selector === "string") {
      if (selector.startsWith("hwnd:")) {
        matches = all.filter((w) => w.id === selector);
      } else {
        const selL = selector.toLowerCase();
        matches = all.filter((w) => w.app.toLowerCase().includes(selL) || w.title.toLowerCase().includes(selL));
      }
    } else {
      matches = all.filter((w) => {
        let ok = true;
        if (selector.app && !w.app.toLowerCase().includes(selector.app.toLowerCase())) ok = false;
        if (selector.title && !w.title.toLowerCase().includes(selector.title.toLowerCase())) ok = false;
        return ok;
      });
    }

    if (matches.length === 0) {
      throw new Error("WindowNotFound: no window matches " + JSON.stringify(selector));
    }

    if (matches.length > 1) {
      const candidates = matches.slice(0, 8).map((m) => "\"" + m.title + "\" (" + m.app + ")").join(" | ");
      throw new Error("AmbiguousWindow: " + matches.length + " windows match " + JSON.stringify(selector) + ": " + candidates);
    }

    return new ComputerWindow(this.#worker, matches[0], this.#readOnly);
  }

  async focusedWindow(): Promise<ComputerWindow | null> {
    const all = await this.windows();
    const focused = all.find((w) => w.focused);
    return focused ? new ComputerWindow(this.#worker, focused, this.#readOnly) : null;
  }

  async launch(executable: string, args: string[] = [], options: { timeoutMs?: number } = {}): Promise<ComputerWindow> {
    this.#assertNotReadOnly("launch");
    const res = await this.#worker.call<any>("launchProcess", {
      executable,
      args,
      timeoutMs: options.timeoutMs || 5000
    });

    if (res.window) {
      return new ComputerWindow(this.#worker, {
        id: res.window.id,
        app: res.window.app,
        title: res.window.title,
        pid: res.window.pid,
        bounds: { x: res.window.x, y: res.window.y, width: res.window.width, height: res.window.height },
        x: res.window.x,
        y: res.window.y,
        width: res.window.width,
        height: res.window.height,
        focused: res.window.focused
      }, this.#readOnly);
    }

    await new Promise((r) => setTimeout(r, 600));
    const baseName = path.basename(executable, path.extname(executable)).toLowerCase();
    const wins = await this.windows();
    const found = wins.find((w) => (res.pid && w.pid === res.pid) || w.app.toLowerCase().includes(baseName));
    if (found) {
      return new ComputerWindow(this.#worker, found, this.#readOnly);
    }

    throw new Error("LaunchSuccessWithoutWindow: process \"" + executable + "\" started (pid=" + res.pid + "), but top-level window was not detected within timeout");
  }

  async screenshot(options: { silent?: boolean; format?: "png" | "jpeg"; maxWidth?: number; maxHeight?: number; display?: number | string | "all" } = {}): Promise<ComputerScreenshotResult> {
    const ts = Date.now();
    const ext = options.format === "jpeg" ? "jpg" : "png";
    const filename = "shot-" + ts + "-" + Math.random().toString(36).slice(2, 7) + "." + ext;
    const hostWin = this.#worker.hostInfo;
    const winPath = hostWin.tempDirWindows + "\\shots\\" + this.#worker.sessionId + "\\" + filename;
    const hostPath = hostWin.toHostPath(winPath);

    const res = await this.#worker.call<any>("capture", {
      target: "screen",
      display: options.display,
      path: winPath,
      format: options.format || "png",
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight
    });

    if (!options.silent) {
      this.#screenshots.push(hostPath);
    }

    return {
      path: hostPath,
      width: res.width,
      height: res.height,
      bytes: res.bytes
    };
  }

  async click(x: number, y: number, options: { button?: "left" | "right" | "middle"; count?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("click");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#worker.call("input.mouse", {
      action: "click",
      x,
      y,
      button: options.button || "left",
      count: options.count || 1
    });
  }

  async doubleClick(x: number, y: number, options: { button?: "left" | "right" | "middle"; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("doubleClick");
    await this.click(x, y, { ...options, count: 2 });
  }

  async move(x: number, y: number): Promise<void> {
    this.#assertNotReadOnly("move");
    await this.#worker.call("input.mouse", { action: "move", x, y });
  }

  async drag(points: Array<[number, number]>, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("drag");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#worker.call("input.mouse", { action: "drag", points });
  }

  async scroll(x: number, y: number, options: { dx?: number; dy?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("scroll");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#worker.call("input.mouse", {
      action: "scroll",
      x,
      y,
      dx: options.dx || 0,
      dy: options.dy || 0
    });
  }

  async type(text: string, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("type");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#worker.call("input.type", { text });
  }

  async press(chord: string | string[], options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("press");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    const keys = Array.isArray(chord) ? chord : chord.split(/[\s+-]+/).map((k) => k.trim()).filter(Boolean);
    await this.#worker.call("input.keyChord", { keys });
  }

  async elementAt(x: number, y: number): Promise<ComputerElement | null> {
    const raw = await this.#worker.call<any>("ax.elementAt", { x, y });
    return raw ? new ComputerElement(this.#worker, raw, this.#readOnly) : null;
  }

  async focusedElement(): Promise<ComputerElement | null> {
    const raw = await this.#worker.call<any>("ax.focused", {});
    return raw ? new ComputerElement(this.#worker, raw, this.#readOnly) : null;
  }

  async ref(tag: string): Promise<ComputerElement> {
    const raw = await this.#worker.call<any>("ref.info", { ref: tag });
    return new ComputerElement(this.#worker, raw, this.#readOnly);
  }

  readonly clipboard = {
    read: async (): Promise<string> => {
      const res = await this.#worker.call<{ text: string }>("clipboard.read", {}, { idempotent: true });
      return res.text || "";
    },
    write: async (text: string): Promise<void> => {
      this.#assertNotReadOnly("clipboard.write");
      await this.#worker.call("clipboard.write", { text: text || "" });
    }
  };

  async close(): Promise<void> {
    this.#worker.dispose();
  }
}
