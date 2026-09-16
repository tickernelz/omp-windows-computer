import { WindowsWorker } from "./worker-client.ts";
import { normalizeUiaRole } from "./roles.ts";

export interface ComputerElementSnapshot {
  ref: string;
  role: string;
  nativeRole: string;
  title?: string;
  description?: string;
  enabled: boolean;
  focused: boolean;
  childCount?: number;
  bounds?: { x: number; y: number; width: number; height: number };
  actions?: string[];
}

export class ComputerElement {
  readonly ref: string;
  readonly role: string;
  readonly nativeRole: string;
  readonly title?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly focused: boolean;
  readonly childCount: number;

  #worker: WindowsWorker;
  #readOnly: boolean;
  #cachedBounds: { x: number; y: number; width: number; height: number } | null = null;
  #cachedActions: string[] = [];

  constructor(worker: WindowsWorker, snapshot: ComputerElementSnapshot, readOnly: boolean = false) {
    this.#worker = worker;
    this.#readOnly = readOnly;
    this.ref = snapshot.ref;
    this.nativeRole = snapshot.nativeRole || snapshot.role;
    this.role = normalizeUiaRole(snapshot.role);
    this.title = snapshot.title;
    this.description = snapshot.description;
    this.enabled = snapshot.enabled ?? true;
    this.focused = snapshot.focused ?? false;
    this.childCount = snapshot.childCount ?? 0;
    if (snapshot.bounds) this.#cachedBounds = snapshot.bounds;
    if (snapshot.actions) this.#cachedActions = snapshot.actions;
  }

  toString(): string {
    return "<element " + this.ref + " " + this.role + ">";
  }

  #assertNotReadOnly(action: string): void {
    if (this.#readOnly) {
      throw new Error("ReadOnly: " + action + " is blocked by read_only: true");
    }
  }

  async value(): Promise<string | undefined> {
    const res = await this.#worker.call<{ value: string | null }>("ref.value", { ref: this.ref }, { idempotent: true });
    return res.value ?? undefined;
  }

  async setValue(value: string): Promise<void> {
    this.#assertNotReadOnly("setValue");
    await this.#worker.call("ref.setValue", { ref: this.ref, value });
  }

  async bounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    if (this.#cachedBounds) return this.#cachedBounds;
    const info = await this.#worker.call<any>("ref.info", { ref: this.ref }, { idempotent: true });
    this.#cachedBounds = info.bounds || null;
    return this.#cachedBounds;
  }

  async attributes(): Promise<Record<string, string>> {
    const info = await this.#worker.call<any>("ref.info", { ref: this.ref }, { idempotent: true });
    return {
      role: this.role,
      nativeRole: this.nativeRole,
      title: this.title || "",
      enabled: String(this.enabled),
      focused: String(this.focused),
      bounds: info.bounds ? info.bounds.x + "," + info.bounds.y + "," + info.bounds.width + "," + info.bounds.height : ""
    };
  }

  async actions(): Promise<string[]> {
    if (this.#cachedActions.length > 0) return this.#cachedActions;
    const info = await this.#worker.call<any>("ref.info", { ref: this.ref }, { idempotent: true });
    this.#cachedActions = info.actions || [];
    return this.#cachedActions;
  }

  async perform(action: string): Promise<void> {
    this.#assertNotReadOnly("perform");
    await this.#worker.call("ref.perform", { ref: this.ref, action });
  }

  async press(): Promise<void> {
    this.#assertNotReadOnly("press");
    await this.perform("Invoke");
  }

  async click(options: { delivery?: "background" | "foreground"; button?: "left" | "right" | "middle" } = {}): Promise<void> {
    this.#assertNotReadOnly("click");
    if (options.delivery === "background") {
      throw new Error("BackgroundUnavailable: the installed native addon supports foreground input only");
    }
    const b = await this.bounds();
    if (!b || b.width <= 0 || b.height <= 0) {
      await this.press();
      return;
    }
    const cx = Math.round(b.x + b.width / 2);
    const cy = Math.round(b.y + b.height / 2);
    await this.#worker.call("input.mouse", {
      action: "click",
      x: cx,
      y: cy,
      button: options.button || "left",
      count: 1
    });
  }

  async type(text: string): Promise<void> {
    this.#assertNotReadOnly("type");
    try {
      await this.focus();
    } catch {}
    await this.#worker.call("input.type", { text });
  }

  async focus(): Promise<void> {
    this.#assertNotReadOnly("focus");
    await this.#worker.call("ref.focus", { ref: this.ref });
  }

  async parent(): Promise<ComputerElement | null> {
    return null;
  }

  async children(): Promise<ComputerElement[]> {
    return [];
  }
}
