import { WindowsWorker } from "./worker-client.ts";
import { normalizeUiaRole } from "./roles.ts";

export interface ComputerElementSnapshot {
  element_index?: number;
  element_token?: string;
  ref?: string;
  role: string;
  nativeRole?: string;
  label?: string;
  title?: string;
  description?: string;
  enabled?: boolean;
  focused?: boolean;
  frame?: { x: number; y: number; w: number; h: number };
  bounds?: { x: number; y: number; width: number; height: number };
  actions?: string[];
  value?: string;
  windowId?: number;
  pid?: number;
}

export class ComputerElement {
  readonly ref: string;
  readonly role: string;
  readonly nativeRole: string;
  readonly title?: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly focused: boolean;
  readonly childCount: number = 0;
  readonly elementIndex?: number;
  readonly elementToken?: string;
  readonly windowId?: number;
  readonly pid?: number;

  #worker: WindowsWorker;
  #readOnly: boolean;
  #bounds: { x: number; y: number; width: number; height: number } | null = null;
  #actions: string[] = [];
  #val?: string;

  constructor(worker: WindowsWorker, snapshot: ComputerElementSnapshot, readOnly: boolean = false) {
    this.#worker = worker;
    this.#readOnly = readOnly;
    this.ref = snapshot.ref || ("e" + (snapshot.element_index ?? 0));
    this.elementIndex = snapshot.element_index;
    this.elementToken = snapshot.element_token;
    this.windowId = snapshot.windowId;
    this.pid = snapshot.pid;
    this.nativeRole = snapshot.nativeRole || snapshot.role;
    this.role = normalizeUiaRole(snapshot.role);
    this.title = snapshot.title || snapshot.label;
    this.description = snapshot.description;
    this.enabled = snapshot.enabled ?? true;
    this.focused = snapshot.focused ?? false;
    this.#val = snapshot.value;

    if (snapshot.frame) {
      this.#bounds = {
        x: snapshot.frame.x,
        y: snapshot.frame.y,
        width: snapshot.frame.w,
        height: snapshot.frame.h
      };
    } else if (snapshot.bounds) {
      this.#bounds = snapshot.bounds;
    }

    if (snapshot.actions) {
      this.#actions = snapshot.actions;
    }
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
    return this.#val;
  }

  async setValue(value: string): Promise<void> {
    this.#assertNotReadOnly("setValue");
    if (this.pid && this.windowId && this.elementIndex !== undefined) {
      await this.#worker.call("set_value", {
        pid: this.pid,
        window_id: this.windowId,
        element_index: this.elementIndex,
        value
      });
      this.#val = value;
    } else {
      throw new Error("SetValueFailed: element lacks PID/windowId context for set_value");
    }
  }

  async bounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return this.#bounds;
  }

  async attributes(): Promise<Record<string, string>> {
    return {
      role: this.role,
      nativeRole: this.nativeRole,
      title: this.title || "",
      enabled: String(this.enabled),
      focused: String(this.focused),
      bounds: this.#bounds ? this.#bounds.x + "," + this.#bounds.y + "," + this.#bounds.width + "," + this.#bounds.height : ""
    };
  }

  async actions(): Promise<string[]> {
    return this.#actions;
  }

  async perform(action: string): Promise<void> {
    await this.click();
  }

  async press(): Promise<void> {
    await this.click();
  }

  async click(options: { delivery?: "background" | "foreground"; button?: "left" | "right" | "middle" } = {}): Promise<void> {
    this.#assertNotReadOnly("click");
    if (this.pid && this.windowId && this.elementIndex !== undefined) {
      await this.#worker.call("click", {
        pid: this.pid,
        window_id: this.windowId,
        element_index: this.elementIndex,
        button: options.button || "left",
        delivery_mode: options.delivery || "foreground"
      });
      return;
    }

    if (this.#bounds && this.#bounds.width > 0) {
      const cx = Math.round(this.#bounds.x + this.#bounds.width / 2);
      const cy = Math.round(this.#bounds.y + this.#bounds.height / 2);
      await this.#worker.call("click", {
        scope: "desktop",
        x: cx,
        y: cy,
        button: options.button || "left",
        delivery_mode: options.delivery || "foreground"
      });
      return;
    }

    throw new Error("ElementClickFailed: element has no index or valid bounds to click");
  }

  async type(text: string): Promise<void> {
    this.#assertNotReadOnly("type");
    if (this.pid && this.windowId && this.elementIndex !== undefined) {
      await this.#worker.call("type_text", {
        pid: this.pid,
        window_id: this.windowId,
        element_index: this.elementIndex,
        text,
        delivery_mode: "foreground"
      });
    } else {
      await this.#worker.call("type_text", { scope: "desktop", text, delivery_mode: "foreground" });
    }
  }

  async focus(): Promise<void> {
    this.#assertNotReadOnly("focus");
    if (this.pid && this.windowId) {
      await this.#worker.call("bring_to_front", { pid: this.pid, window_id: this.windowId });
    }
  }

  async parent(): Promise<ComputerElement | null> {
    return null;
  }

  async children(): Promise<ComputerElement[]> {
    return [];
  }
}
