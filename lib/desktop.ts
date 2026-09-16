import * as fs from "node:fs";
import * as path from "node:path";
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

export interface WindowsAppInfo {
  name: string;
  kind: "desktop" | "uwp";
  running: boolean;
  active: boolean;
  pid: number;
  launch_path: string | null;
  last_used?: string | null;
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
    const screen = await this.#worker.call<any>("get_screen_size", {});
    return {
      backend: "win32 (cua-driver full)",
      displayServer: "windows",
      capture: true,
      input: true,
      ax: true,
      backgroundWindowInput: true,
      deliveryModes: ["background", "foreground"],
      capturePermission: "granted",
      inputPermission: "granted",
      axPermission: "granted",
      displayCount: screen?.width ? 1 : 1
    };
  }

  async displays(): Promise<ComputerDisplay[]> {
    const screen = await this.#worker.call<any>("get_screen_size", {});
    const w = screen.width || 1920;
    const h = screen.height || 1080;
    const scale = screen.scale_factor || 1.0;
    return [
      {
        id: "primary",
        name: "Primary Display",
        scale,
        x: 0,
        y: 0,
        width: w,
        height: h,
        pixelX: 0,
        pixelY: 0,
        pixelWidth: w,
        pixelHeight: h,
        isPrimary: true
      }
    ];
  }

  async windows(filter?: ComputerWindowFilter): Promise<ComputerWindowInfo[]> {
    const raw = await this.#worker.call<any>("list_windows", {});
    const list: ComputerWindowInfo[] = (raw._legacy_windows || []).map((w: any) => ({
      id: "hwnd:" + w.window_id,
      windowId: w.window_id,
      pid: w.pid,
      app: w.title.split(" - ").pop()?.trim() || "window",
      title: w.title,
      bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      focused: Boolean(w.is_on_screen && !w.minimized)
    }));

    if (!filter) return list;

    let filtered = list;
    if (filter.app) {
      const appL = filter.app.toLowerCase();
      filtered = filtered.filter((w) => w.app.toLowerCase().includes(appL) || w.title.toLowerCase().includes(appL));
    }
    if (filter.title) {
      const titleL = filter.title.toLowerCase();
      filtered = filtered.filter((w) => w.title.toLowerCase().includes(titleL));
    }
    return filtered;
  }

  async apps(): Promise<WindowsAppInfo[]> {
    const res = await this.#worker.call<{ apps: WindowsAppInfo[] }>("list_apps", {}, { idempotent: true });
    return res.apps || [];
  }

  async kill(pid: number): Promise<void> {
    this.#assertNotReadOnly("kill");
    await this.#worker.call("kill_app", { pid });
  }

  async driverCall<T = any>(toolName: string, params: Record<string, unknown> = {}): Promise<T> {
    return await this.#worker.call<T>(toolName, params);
  }

  async window(selector: string | ComputerWindowFilter): Promise<ComputerWindow> {
    const all = await this.windows();
    let matches: ComputerWindowInfo[] = [];

    if (typeof selector === "string") {
      if (selector.startsWith("hwnd:")) {
        const idNum = parseInt(selector.replace("hwnd:", ""), 10);
        matches = all.filter((w) => w.windowId === idNum || w.id === selector);
      } else {
        const selL = selector.toLowerCase();
        matches = all.filter((w) => w.app.toLowerCase().includes(selL) || w.title.toLowerCase().includes(selL));
      }
    } else {
      matches = all.filter((w) => {
        let ok = true;
        if (selector.app && !w.app.toLowerCase().includes(selector.app.toLowerCase()) && !w.title.toLowerCase().includes(selector.app.toLowerCase())) ok = false;
        if (selector.title && !w.title.toLowerCase().includes(selector.title.toLowerCase())) ok = false;
        return ok;
      });
    }

    if (matches.length === 0) {
      throw new Error("WindowNotFound: no window matches " + JSON.stringify(selector));
    }

    if (matches.length > 1) {
      const candidates = matches.slice(0, 8).map((m) => "\"" + m.title + "\" (pid=" + m.pid + ")").join(" | ");
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
    const res = await this.#worker.call<any>("launch_app", {
      path: executable,
      urls: args
    });

    const pid = res.pid;
    const timeout = options.timeoutMs || 6000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const wins = await this.windows();
      const matched = wins.find((w) => w.pid === pid);
      if (matched) {
        return new ComputerWindow(this.#worker, matched, this.#readOnly);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const base = path.basename(executable, path.extname(executable)).toLowerCase();
    const fallback = (await this.windows()).find((w) => w.title.toLowerCase().includes(base));
    if (fallback) {
      return new ComputerWindow(this.#worker, fallback, this.#readOnly);
    }

    throw new Error("LaunchSuccessWithoutWindow: process \"" + executable + "\" launched (pid=" + pid + "), but window was not resolved within timeout");
  }

  async screenshot(options: { silent?: boolean; format?: "png" | "jpeg"; maxWidth?: number; maxHeight?: number; display?: number | string | "all" } = {}): Promise<ComputerScreenshotResult> {
    const ts = Date.now();
    const filename = "desk-" + ts + "-" + Math.random().toString(36).slice(2, 7) + ".png";
    const hostWin = this.#worker.hostInfo;
    const hostPath = path.join(hostWin.tempDirHost, "shots", this.#worker.sessionId, filename);
    const winPath = hostWin.toWindowsPath(hostPath);

    fs.mkdirSync(path.dirname(hostPath), { recursive: true });

    const res = await this.#worker.call<any>("get_desktop_state", {
      screenshot_out_file: winPath
    });

    let fileSize = 0;
    if (fs.existsSync(hostPath)) {
      fileSize = fs.statSync(hostPath).size;
    } else if (res.screenshot_png_b64) {
      const buf = Buffer.from(res.screenshot_png_b64, "base64");
      fs.writeFileSync(hostPath, buf);
      fileSize = buf.length;
    } else {
      throw new Error("ScreenshotFailed: cua-driver did not generate screenshot: " + JSON.stringify(res));
    }

    if (!options.silent) {
      this.#screenshots.push(hostPath);
    }

    return {
      path: hostPath,
      width: res.screenshot_width || 1920,
      height: res.screenshot_height || 1080,
      bytes: fileSize
    };
  }

  async click(x: number, y: number, options: { button?: "left" | "right" | "middle"; count?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("click");
    await this.#worker.call("click", {
      scope: "desktop",
      x,
      y,
      button: options.button || "left",
      count: options.count || 1,
      delivery_mode: options.delivery || "foreground"
    });
  }

  async doubleClick(x: number, y: number, options: { button?: "left" | "right" | "middle"; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("doubleClick");
    await this.click(x, y, { ...options, count: 2 });
  }

  async move(x: number, y: number): Promise<void> {
    this.#assertNotReadOnly("move");
    await this.#worker.call("move_cursor", { x, y });
  }

  async drag(points: Array<[number, number]>, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("drag");
    if (points.length < 2) return;
    const [from, to] = [points[0], points[points.length - 1]];
    await this.#worker.call("drag", {
      scope: "desktop",
      from_x: from[0],
      from_y: from[1],
      to_x: to[0],
      to_y: to[1]
    });
  }

  async scroll(x: number, y: number, options: { dx?: number; dy?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("scroll");
    await this.#worker.call("scroll", {
      scope: "desktop",
      x,
      y,
      delta_x: options.dx || 0,
      delta_y: options.dy || 0
    });
  }

  async type(text: string, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("type");
    await this.#worker.call("type_text", {
      scope: "desktop",
      text,
      delivery_mode: options.delivery || "foreground"
    });
  }

  async press(chord: string | string[], options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("press");
    const keys = Array.isArray(chord) ? chord : chord.split(/[\s+-]+/).map((k) => k.trim()).filter(Boolean);
    if (keys.length === 1) {
      await this.#worker.call("press_key", { key: keys[0], scope: "desktop" });
    } else {
      await this.#worker.call("hotkey", { keys, scope: "desktop" });
    }
  }

  async elementAt(x: number, y: number): Promise<ComputerElement | null> {
    return null;
  }

  async focusedElement(): Promise<ComputerElement | null> {
    return null;
  }

  async ref(tag: string): Promise<ComputerElement> {
    throw new Error("Ref lookup requires window context. Use win.ref(tag) or win.find(query)");
  }

  readonly clipboard = {
    read: async (): Promise<string> => {
      const res = await this.#worker.call<any>("clipboard_read", { text_fallback: true });
      return res.text || "";
    },
    write: async (text: string): Promise<void> => {
      this.#assertNotReadOnly("clipboard.write");
      await this.#worker.call("clipboard_write", { text: text || "" });
    }
  };

  async close(): Promise<void> {
    this.#worker.dispose();
  }
}
