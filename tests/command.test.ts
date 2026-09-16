import { test } from "node:test";
import * as assert from "node:assert";
import { getWinComputerCompletions, formatSettingsOverview } from "../lib/command.ts";
import { getDefaultConfig } from "../lib/config.ts";

test("getWinComputerCompletions: returns subcommands and keys on empty prefix", () => {
  const items = getWinComputerCompletions("");
  assert.ok(items.length >= 8);
  const values = items.map((i) => i.value);
  assert.ok(values.includes("doctor"));
  assert.ok(values.includes("update"));
  assert.ok(values.includes("install"));
  assert.ok(values.includes("status"));
  assert.ok(values.includes("windows"));
  assert.ok(values.includes("reset"));
  assert.ok(values.includes("maxWidth"));
  assert.ok(values.includes("autoUpdate"));
});

test("getWinComputerCompletions: filters by prefix", () => {
  const items = getWinComputerCompletions("doc");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].value, "doctor");
});

test("getWinComputerCompletions: completes enum values for keys", () => {
  const items = getWinComputerCompletions("imageFormat ");
  assert.strictEqual(items.length, 2);
  const values = items.map((i) => i.value);
  assert.ok(values.includes("imageFormat png"));
  assert.ok(values.includes("imageFormat jpeg"));
});

test("getWinComputerCompletions: completes boolean values for keys", () => {
  const items = getWinComputerCompletions("autoUpdate ");
  assert.strictEqual(items.length, 2);
  const values = items.map((i) => i.value);
  assert.ok(values.includes("autoUpdate on"));
  assert.ok(values.includes("autoUpdate off"));
});

test("formatSettingsOverview: includes all schema keys and descriptions", () => {
  const text = formatSettingsOverview(getDefaultConfig());
  assert.ok(text.includes("maxWidth"));
  assert.ok(text.includes("autoUpdate"));
  assert.ok(text.includes("/win-computer doctor"));
  assert.ok(text.includes("/win-computer update"));
});
