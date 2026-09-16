import { WindowsWorker } from "./worker-client.ts";
import { ComputerElement, type ComputerElementSnapshot } from "./element.ts";
import type { ComputerScreenshotResult } from "./desktop.ts";

export interface ComputerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerWindowInfo extends ComputerBounds {
  id: string;
  app: string;
  title: string;
  pid?: number;
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
  readonly app: string;
  readonly title: string;
  readonly pid?: number;
  readonly bounds: ComputerBounds;
  readonly focused: boolean;

  #worker: WindowsWorker;
  #readOnly: boolean;

  constructor(worker: WindowsWorker, info: ComputerWindowInfo, readOnly: boolean = false) {
    this.#worker = worker;
    this.#readOnly = readOnly;
    this.id = info.id;
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

  async #ensureForeground(): Promise<void> {
    await this.raise();
    await new Promise((r) => setTimeout(r, 60));
  }

  async raise(): Promise<void> {
    this.#assertNotReadOnly("raise");
    const hwndNum = parseInt(this.id.replace("hwnd:", ""), 10);
    await this.#worker.call("raiseWindow", { hwnd: hwndNum });
  }

  async screenshot(options: { silent?: boolean; format?: "png" | "jpeg"; maxWidth?: number; maxHeight?: number } = {}): Promise<ComputerScreenshotResult> {
    const ts = Date.now();
    const ext = options.format === "jpeg" ? "jpg" : "png";
    const filename = "win-" + this.app + "-" + ts + "." + ext;
    const hostWin = this.#worker.hostInfo;
    const winPath = hostWin.tempDirWindows + "\\shots\\" + this.#worker.sessionId + "\\" + filename;
    const hostPath = hostWin.toHostPath(winPath);

    const res = await this.#worker.call<any>("capture", {
      target: this.id,
      path: winPath,
      format: options.format || "png",
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight
    });

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
    await this.#ensureForeground();
    const globalX = this.bounds.x + x;
    const globalY = this.bounds.y + y;
    await this.#worker.call("input.mouse", {
      action: "click",
      x: globalX,
      y: globalY,
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
    await this.#ensureForeground();
    const globalX = this.bounds.x + x;
    const globalY = this.bounds.y + y;
    await this.#worker.call("input.mouse", { action: "move", x: globalX, y: globalY });
  }

  async drag(points: Array<[number, number]>, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("drag");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#ensureForeground();
    const globalPoints = points.map(([px, py]) => [this.bounds.x + px, this.bounds.y + py]);
    await this.#worker.call("input.mouse", { action: "drag", points: globalPoints });
  }

  async scroll(x: number, y: number, options: { dx?: number; dy?: number; delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("scroll");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#ensureForeground();
    const globalX = this.bounds.x + x;
    const globalY = this.bounds.y + y;
    await this.#worker.call("input.mouse", { action: "scroll", x: globalX, y: globalY, dx: options.dx || 0, dy: options.dy || 0 });
  }

  async type(text: string, options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("type");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#ensureForeground();
    await this.#worker.call("input.type", { text });
  }

  async press(chord: string | string[], options: { delivery?: "background" | "foreground" } = {}): Promise<void> {
    this.#assertNotReadOnly("press");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    await this.#ensureForeground();
    const keys = Array.isArray(chord) ? chord : chord.split(/[\s+-]+/).map((k) => k.trim()).filter(Boolean);
    await this.#worker.call("input.keyChord", { keys });
  }

  async ax(options: ComputerAxOptions = {}): Promise<string> {
    const hwndNum = parseInt(this.id.replace("hwnd:", ""), 10);
    const res = await this.#worker.call<{ tree: string }>("ax.snapshot", {
      hwnd: hwndNum,
      maxDepth: options.maxDepth || 12,
      maxNodes: options.maxNodes || 800,
      all: options.all ?? false
    }, { idempotent: true });
    return res.tree;
  }

  async find(query: ComputerAxQuery): Promise<ComputerElement[]> {
    const hwndNum = parseInt(this.id.replace("hwnd:", ""), 10);
    const rawList = await this.#worker.call<ComputerElementSnapshot[]>("ax.query", {
      hwnd: hwndNum,
      role: query.role,
      title: query.title,
      limit: query.limit || 10
    }, { idempotent: true });
    return rawList.map((item) => new ComputerElement(this.#worker, item, this.#readOnly));
  }

  async ref(tag: string): Promise<ComputerElement> {
    const raw = await this.#worker.call<ComputerElementSnapshot>("ref.info", { ref: tag }, { idempotent: true });
    return new ComputerElement(this.#worker, raw, this.#readOnly);
  }
}
