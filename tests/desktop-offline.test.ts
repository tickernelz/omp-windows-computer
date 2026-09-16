import { test } from "node:test";
import * as assert from "node:assert";
import { ComputerDesktop } from "../lib/desktop.ts";
import { WindowsWorker } from "../lib/worker-client.ts";
import { EventEmitter } from "node:events";

test("ComputerDesktop: window selector ambiguity and not found handling", async () => {
  class FakeProcess extends EventEmitter {
    stdin = { write: () => {} };
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    killed = false;
    exitCode = null;
    kill() {}
  }

  const fakeProc = new FakeProcess();
  const fakeSpawn: any = () => fakeProc;

  const worker = new WindowsWorker({
    hostInfo: {
      kind: "wsl",
      shellPath: "/mock/powershell.exe",
      toWindowsPath: (p) => p,
      toHostPath: (p) => p,
      tempDirHost: "/tmp/mock",
      tempDirWindows: "C:\\mock",
      systemRootWindows: "C:\\Windows",
      programFilesWindows: "C:\\Program Files"
    },
    spawnFn: fakeSpawn
  });

  // Mock call directly on worker
  (worker as any).call = async (method: string, params: any) => {
    if (method === "windows") {
      return [
        { id: "hwnd:1", app: "chrome", title: "Google Chrome - Tab 1", pid: 10, x: 0, y: 0, width: 800, height: 600, focused: false },
        { id: "hwnd:2", app: "chrome", title: "Google Chrome - Tab 2", pid: 10, x: 10, y: 10, width: 800, height: 600, focused: true },
        { id: "hwnd:3", app: "code", title: "VS Code", pid: 20, x: 0, y: 0, width: 1000, height: 800, focused: false }
      ];
    }
    return {};
  };

  const desktop = new ComputerDesktop(worker);

  // Exact 1 match
  const codeWin = await desktop.window({ app: "code" });
  assert.strictEqual(codeWin.id, "hwnd:3");
  assert.strictEqual(codeWin.app, "code");

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
    async () => await desktop.window({ app: "nonexistent" }),
    (err: any) => {
      assert.ok(err.message.includes("WindowNotFound"));
      return true;
    }
  );

  // Focused window
  const focused = await desktop.focusedWindow();
  assert.strictEqual(focused?.id, "hwnd:2");
});
