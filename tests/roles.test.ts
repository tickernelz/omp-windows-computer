import { test } from "node:test";
import * as assert from "node:assert";
import { normalizeUiaRole, UIA_TO_NORMALIZED_ROLES } from "../lib/roles.ts";

test("normalizeUiaRole: standard role conversions", () => {
  assert.strictEqual(normalizeUiaRole("ControlType.Button"), "button");
  assert.strictEqual(normalizeUiaRole("ControlType.Edit"), "textbox");
  assert.strictEqual(normalizeUiaRole("ControlType.Document"), "document");
  assert.strictEqual(normalizeUiaRole("ControlType.Pane"), "panel");
  assert.strictEqual(normalizeUiaRole("ControlType.Tab"), "tabgroup");
  assert.strictEqual(normalizeUiaRole("ControlType.TabItem"), "tab");
  assert.strictEqual(normalizeUiaRole("button"), "button");
});

test("normalizeUiaRole: fallback for unknown roles", () => {
  assert.strictEqual(normalizeUiaRole("ControlType.SomeCustomWidget"), "somecustomwidget");
  assert.strictEqual(normalizeUiaRole(""), "unknown");
});
