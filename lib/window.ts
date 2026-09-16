import * as fs from "node:fs";
import * as path from "node:path";
import { WindowsWorker } from "./worker-client.ts";
import { ComputerElement, type ComputerElementSnapshot } from "./element.ts";
import type { ComputerScreenshotResult } from "./desktop.ts";
import { optimizeScreenshot } from "./image-optimizer.ts";

export interface ComputerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerWindowInfo extends ComputerBounds {
  id: string;
  windowId: number;
  app: string;
  title: string;
  pid: number;
  focused: boolean;
  bounds: ComputerBounds;
}

export interface ComputerWindowFilter {
  app?: string;
  title?: string;
}

export interface ComputerAxOptions {
  all?: boolean;
  maxDepth?: number;
  maxNodes?: number;
}

export interface ComputerAxQuery {
  role?: string;
  title?: string;
  value?: string;
  limit?: number;
}

export class ComputerWindow {
  readonly id: string;
  readonly windowId: number;
  readonly app: string;
  readonly title: string;
  readonly pid: number;
  readonly bounds: ComputerBounds;
  readonly focused: boolean;

  #worker: WindowsWorker;
  #readOnly: boolean;

  constructor(worker: WindowsWorker, info: ComputerWindowInfo, readOnly: boolean = false) {
    this.#worker = worker;
    this.#readOnly = readOnly;
    this.id = info.id;
    this.windowId = info.windowId;
    this.app = info.app;
    this.title = info.title;
    this.pid = info.pid;
    this.bounds = info.bounds;
    this.focused = info.focused;
  }

  toString(): string {
    return "<window " + this.id + " " + this.app + ">";
  }

  #assertNotReadOnly(action: string): void {
    if (this.#readOnly) {
      throw new Error("ReadOnly: " + action + " is blocked by read_only: true");
    }
  }

  async raise(): Promise<void> {
    this.#assertNotReadOnly("raise");
    await this.#worker.call("bring_to_front", {
      pid: this.pid,
      window_id: this.windowId
    });
  }

  async navigate(url: string): Promise<void> {
    this.#assertNotReadOnly("navigate");
    await this.raise();
    await new Promise((r) => setTimeout(r, 80));

    // 1. Focus address bar with Ctrl+L
    await this.press(["ctrl", "l"]);
    await new Promise((r) => setTimeout(r, 120));

    // 2. Write URL to host clipboard and paste instantly
    await this.#worker.call("clipboard_write", { text: url });
    await this.press(["ctrl", "v"]);
    await new Promise((r) => setTimeout(r, 120));

    // 3. Submit navigation
    await this.#worker.call("press_key", { key: "return", scope: "desktop" });
    await new Promise((r) => setTimeout(r, 400));
  }

  async setFrame(x: number, y: number, width: number, height: number): Promise<void> {
    this.#assertNotReadOnly("setFrame");
    await this.#worker.call("set_window_frame", {
      pid: this.pid,
      window_id: this.windowId,
      x,
      y,
      width,
      height
    });
  }

  async zoom(x1: number, y1: number, x2: number, y2: number): Promise<ComputerScreenshotResult> {
    const res = await this.#worker.call<any>("zoom", {
      pid: this.pid,
      window_id: this.windowId,
      x1,
      y1,
      x2,
      y2
    });

    const b64 = res.screenshot_png_b64;
    if (!b64) {
      throw new Error("ZoomFailed: cua-driver returned empty zoom image");
    }

    const buf = Buffer.from(b64, "base64");
    const ts = Date.now();
    const filename = "zoom-" + this.app + "-" + ts + ".png";
    const hostWin = this.#worker.hostInfo;
    const hostPath = path.join(hostWin.tempDirHost, "shots", this.#worker.sessionId, filename);

    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(hostPath, buf);

    return {
      path: hostPath,
      width: res.screenshot_width || (x2 - x1),
      height: res.screenshot_height || (y2 - y1),
      bytes: buf.length
    };
  }

  async invokeMenu(menuPath: string[]): Promise<void> {
    this.#assertNotReadOnly("invokeMenu");
    await this.#worker.call("invoke_menu", {
      pid: this.pid,
      window_id: this.windowId,
      path: menuPath
    });
  }

  async verify(expect: any[], options: { timeoutMs?: number } = {}): Promise<any> {
    return await this.#worker.call("verify_state", {
      pid: this.pid,
      window_id: this.windowId,
      expect,
      timeout_ms: options.timeoutMs || 5000
    });
  }

  async screenshot(options: { silent?: boolean; format?: "png" | "jpeg"; maxWidth?: number; maxHeight?: number } = {}): Promise<ComputerScreenshotResult> {
    const res = await this.#worker.call<any>("get_window_state", {
      pid: this.pid,
      window_id: this.windowId
    });

    const b64 = res.screenshot_png_b64;
    if (!b64) {
      throw new Error("ScreenshotFailed: get_window_state returned empty image");
    }

    const buf = Buffer.from(b64, "base64");
    const ts = Date.now();
    const filename = "win-" + this.app + "-" + ts + ".png";
    const hostWin = this.#worker.hostInfo;
    const hostPath = path.join(hostWin.tempDirHost, "shots", this.#worker.sessionId, filename);

    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(hostPath, buf);

    // Auto-compress & downscale using image-optimizer (default max 1280px JPEG, ~40KB)
    const optimized = optimizeScreenshot(hostPath, {
      maxWidth: options.maxWidth || 1280,
      format: options.format || "jpeg"
    });

    return {
      path: optimized.path,
      width: optimized.width,
      height: optimized.height,
      bytes: optimized.bytes
    };
  }

  async click(x: number, y: number, options: { button?: "left" | "right" | "middle"; count?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("click");
    await this.#worker.call("click", {
      pid: this.pid,
      window_id: this.windowId,
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
    const globalX = this.bounds.x + x;
    const globalY = this.bounds.y + y;
    await this.#worker.call("move_cursor", { x: globalX, y: globalY });
  }

  async drag(points: Array<[number, number]>, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("drag");
    if (points.length < 2) return;
    const [from, to] = [points[0], points[points.length - 1]];
    await this.#worker.call("drag", {
      pid: this.pid,
      from_x: from[0],
      from_y: from[1],
      to_x: to[0],
      to_y: to[1]
    });
  }

  async scroll(x: number, y: number, options: { dx?: number; dy?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("scroll");
    await this.#worker.call("scroll", {
      pid: this.pid,
      x,
      y,
      delta_x: options.dx || 0,
      delta_y: options.dy || 0
    });
  }

  async type(text: string, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("type");
    await this.#worker.call("bring_to_front", { pid: this.pid, window_id: this.windowId });
    await new Promise((r) => setTimeout(r, 60));
    await this.#worker.call("type_text", {
      pid: this.pid,
      window_id: this.windowId,
      text,
      delivery_mode: options.delivery || "foreground"
    });
  }

  async press(chord: string | string[], options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("press");
    const keys = Array.isArray(chord) ? chord : chord.split(/[\s+-]+/).map((k) => k.trim()).filter(Boolean);
    try {
      if (keys.length === 1) {
        await this.#worker.call("press_key", {
          pid: this.pid,
          key: keys[0]
        });
      } else {
        await this.#worker.call("hotkey", {
          pid: this.pid,
          keys
        });
      }
    } catch {
      await this.raise();
      if (keys.length === 1) {
        await this.#worker.call("press_key", { key: keys[0], scope: "desktop" });
      } else {
        await this.#worker.call("hotkey", { keys, scope: "desktop" });
      }
    }
  }

  async ax(options: ComputerAxOptions = {}): Promise<string> {
    const res = await this.#worker.call<any>("get_window_state", {
      pid: this.pid,
      window_id: this.windowId
    }, { idempotent: true });
    return res.markdown_tree || (res.window_title ? "- window \"" + res.window_title + "\" [ref=e0]" : "");
  }

  async find(query: ComputerAxQuery): Promise<ComputerElement[]> {
    const res = await this.#worker.call<any>("get_window_state", {
      pid: this.pid,
      window_id: this.windowId
    }, { idempotent: true });

    const elements: any[] = res.elements || [];
    let matched = elements;

    if (query.role) {
      const rL = query.role.toLowerCase();
      matched = matched.filter((e) => (e.role || "").toLowerCase().includes(rL));
    }
    if (query.title) {
      const tL = query.title.toLowerCase();
      matched = matched.filter((e) => (e.label || "").toLowerCase().includes(tL));
    }

    const limit = query.limit || 10;
    return matched.slice(0, limit).map((e) => new ComputerElement(this.#worker, {
      ...e,
      pid: this.pid,
      windowId: this.windowId
    }, this.#readOnly));
  }

  async ref(tag: string): Promise<ComputerElement> {
    const res = await this.#worker.call<any>("get_window_state", {
      pid: this.pid,
      window_id: this.windowId
    }, { idempotent: true });

    const idx = parseInt(tag.replace(/^e/i, ""), 10);
    const elements: any[] = res.elements || [];
    const el = elements.find((e) => e.element_index === idx);

    if (!el) {
      throw new Error("StaleRef: element '" + tag + "' has expired; re-take win.ax() snapshot");
    }

    return new ComputerElement(this.#worker, {
      ...el,
      pid: this.pid,
      windowId: this.windowId
    }, this.#readOnly);
  }
}
