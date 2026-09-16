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
