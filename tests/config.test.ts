import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SCHEMA, getDefaultConfig, validateSetting, saveSetting, loadConfig, resetSettings, PLUGIN_NAME } from "../lib/config.ts";

test("validateSetting: number bounds and parsing", () => {
  assert.strictEqual(validateSetting("maxWidth", "1920").ok, true);
  assert.strictEqual((validateSetting("maxWidth", "1920") as any).value, 1920);
  assert.strictEqual(validateSetting("maxWidth", 100).ok, false);
  assert.strictEqual(validateSetting("maxWidth", 9000).ok, false);
  assert.strictEqual(validateSetting("maxWidth", "not-a-number").ok, false);
});

test("validateSetting: boolean parsing (on/off/true/false)", () => {
  assert.strictEqual((validateSetting("autoUpdate", "on") as any).value, true);
  assert.strictEqual((validateSetting("autoUpdate", "off") as any).value, false);
  assert.strictEqual((validateSetting("autoUpdate", "true") as any).value, true);
  assert.strictEqual((validateSetting("autoUpdate", "false") as any).value, false);
  assert.strictEqual((validateSetting("autoUpdate", true) as any).value, true);
  assert.strictEqual(validateSetting("autoUpdate", "invalid").ok, false);
});

test("validateSetting: enum options", () => {
  assert.strictEqual((validateSetting("imageFormat", "png") as any).value, "png");
  assert.strictEqual((validateSetting("imageFormat", "jpeg") as any).value, "jpeg");
  assert.strictEqual(validateSetting("imageFormat", "gif").ok, false);
});

test("package.json settings schema matches lib/config.ts SCHEMA (drift guard)", () => {
  const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const declaredSettings = pkg.omp.settings;

  const schemaKeys = Object.keys(SCHEMA).sort();
  const declaredKeys = Object.keys(declaredSettings).sort();
  assert.deepStrictEqual(declaredKeys, schemaKeys, "Declared settings in package.json must match SCHEMA keys");

  for (const k of schemaKeys) {
    const s = SCHEMA[k];
    const d = declaredSettings[k];
    assert.strictEqual(d.type, s.type, `type mismatch on ${k}`);
    assert.strictEqual(d.default, s.default, `default mismatch on ${k}`);
  }
});

test("saveSetting and loadConfig: lockfile persistence and reset", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-cfg-unit-"));
  const testLock = path.join(tmpDir, "omp-plugins.lock.json");

  saveSetting("maxWidth", 2560, testLock);
  saveSetting("imageFormat", "jpeg", testLock);

  const lockContent = JSON.parse(fs.readFileSync(testLock, "utf8"));
  assert.strictEqual(lockContent.settings[PLUGIN_NAME].maxWidth, 2560);
  assert.strictEqual(lockContent.settings[PLUGIN_NAME].imageFormat, "jpeg");

  resetSettings(testLock);
  const resetContent = JSON.parse(fs.readFileSync(testLock, "utf8"));
  assert.strictEqual(resetContent.settings[PLUGIN_NAME], undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
