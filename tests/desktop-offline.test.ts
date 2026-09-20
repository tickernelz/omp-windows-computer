import { test } from "node:test";
import * as assert from "node:assert";
import { ComputerDesktop } from "../lib/desktop.ts";
import { WindowsWorker } from "../lib/worker-client.ts";

test("ComputerDesktop: window selector ambiguity and not found handling", async () => {
  const worker = new WindowsWorker({
    driverPath: "/mock/cua-driver.exe",
    hostInfo: {
      kind: "wsl",
      shellPath: "/mock/powershell.exe",
      toWindowsPath: (p) => p,
      toHostPath: (p) => p,
      tempDirHost: "/tmp/mock",
      tempDirWindows: "C:\\mock",
      systemRootWindows: "C:\\Windows",
      programFilesWindows: "C:\\Program Files"
    }
  });

  (worker as any).call = async (method: string, params: any) => {
    if (method === "list_windows") {
      return {
        _legacy_windows: [
          { window_id: 1, pid: 10, title: "Google Chrome - Tab 1", x: 0, y: 0, width: 800, height: 600, is_on_screen: true, minimized: false },
          { window_id: 2, pid: 10, title: "Google Chrome - Tab 2", x: 10, y: 10, width: 800, height: 600, is_on_screen: true, minimized: false },
          { window_id: 3, pid: 20, title: "VS Code", x: 0, y: 0, width: 1000, height: 800, is_on_screen: true, minimized: false }
        ]
      };
    }
    return {};
  };

  const desktop = new ComputerDesktop(worker);

  // Exact 1 match
  const codeWin = await desktop.window({ app: "code" });
  assert.strictEqual(codeWin.id, "hwnd:3");
  assert.strictEqual(codeWin.windowId, 3);

  // Ambiguous match
  await assert.rejects(
    async () => await desktop.window({ app: "chrome" }),
    (err: any) => {
      assert.ok(err.message.includes("AmbiguousWindow: 2 windows match"));
      assert.ok(err.message.includes("Google Chrome - Tab 1"));
      return true;
    }
  );

  // Not found
  await assert.rejects(
    async () => await desktop.window({ app: "nonexistent_app_999" }),
    (err: any) => {
      assert.ok(err.message.includes("WindowNotFound"));
      return true;
    }
  );
});

test("ComputerWindow: find matches normalized and raw roles, ax passes include_screenshot false", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const worker = new WindowsWorker({
    driverPath: "/mock/cua-driver.exe",
    hostInfo: {
      kind: "wsl",
      shellPath: "/mock/powershell.exe",
      toWindowsPath: (p) => p,
      toHostPath: (p) => p,
      tempDirHost: "/tmp/mock",
      tempDirWindows: "C:\\mock",
      systemRootWindows: "C:\\Windows",
      programFilesWindows: "C:\\Program Files"
    }
  });

  (worker as any).call = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "get_window_state") {
      return {
        tree_markdown: "- window [ref=e0]\n  - edit [ref=e1]",
        elements: [
          { element_index: 0, element_token: "s1:0", role: "Window", label: "App" },
          { element_index: 1, element_token: "s1:1", role: "Edit", label: "Search input" }
        ]
      };
    }
    return {};
  };

  const desktop = new ComputerDesktop(worker);
  const win = new (desktop as any).constructor(worker).window;
  const dummyWin = new (await import("../lib/window.ts")).ComputerWindow(worker, {
    id: "hwnd:1",
    windowId: 1,
    app: "test",
    title: "test",
    pid: 100,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    focused: true
  });

  const byNorm = await dummyWin.find({ role: "textbox" });
  assert.strictEqual(byNorm.length, 1);
  assert.strictEqual(byNorm[0].elementToken, "s1:1");

  const byRaw = await dummyWin.find({ role: "edit" });
  assert.strictEqual(byRaw.length, 1);
  assert.strictEqual(byRaw[0].elementToken, "s1:1");

  const axRes = await dummyWin.ax();
  assert.ok(axRes.includes("- window"));

  assert.strictEqual(calls[0].params.include_screenshot, false);
  assert.strictEqual(calls[1].params.include_screenshot, false);
});

test("ComputerElement: click, setValue, and type forward element_token", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const worker = new WindowsWorker({
    driverPath: "/mock/cua-driver.exe",
    hostInfo: {
      kind: "wsl",
      shellPath: "/mock/powershell.exe",
      toWindowsPath: (p) => p,
      toHostPath: (p) => p,
      tempDirHost: "/tmp/mock",
      tempDirWindows: "C:\\mock",
      systemRootWindows: "C:\\Windows",
      programFilesWindows: "C:\\Program Files"
    }
  });

  (worker as any).call = async (method: string, params: any) => {
    calls.push({ method, params });
    return {};
  };

  const { ComputerElement } = await import("../lib/element.ts");
  const el = new ComputerElement(worker, {
    pid: 50,
    windowId: 500,
    element_index: 3,
    element_token: "s009:3",
    role: "Edit",
    label: "Field"
  });

  await el.click();
  assert.strictEqual(calls[0].method, "click");
  assert.strictEqual(calls[0].params.element_token, "s009:3");
  assert.strictEqual(calls[0].params.element_index, 3);

  await el.setValue("hello");
  assert.strictEqual(calls[1].method, "set_value");
  assert.strictEqual(calls[1].params.element_token, "s009:3");
  assert.strictEqual(calls[1].params.value, "hello");

  await el.type("world");
  assert.strictEqual(calls[2].method, "type_text");
  assert.strictEqual(calls[2].params.element_token, "s009:3");
  assert.strictEqual(calls[2].params.text, "world");
});

test("ComputerDesktop: launch passes additional_arguments and handles immediate windows", async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const worker = new WindowsWorker({
    driverPath: "/mock/cua-driver.exe",
    hostInfo: {
      kind: "wsl",
      shellPath: "/mock/powershell.exe",
      toWindowsPath: (p) => p,
      toHostPath: (p) => p,
      tempDirHost: "/tmp/mock",
      tempDirWindows: "C:\\mock",
      systemRootWindows: "C:\\Windows",
      programFilesWindows: "C:\\Program Files"
    }
  });

  (worker as any).call = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "launch_app") {
      return {
        pid: 77,
        windows: [
          { window_id: 770, pid: 77, title: "Test App", x: 0, y: 0, width: 640, height: 480, is_on_screen: true, minimized: false }
        ]
      };
    }
    return {};
  };

  const desktop = new ComputerDesktop(worker);
  const win = await desktop.launch("test.exe", ["--flag", "val"]);

  assert.strictEqual(calls[0].method, "launch_app");
  assert.deepStrictEqual(calls[0].params.additional_arguments, ["--flag", "val"]);
  assert.strictEqual(win.windowId, 770);
  assert.strictEqual(win.pid, 77);
});
