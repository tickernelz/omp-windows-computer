import test from "node:test";
import assert from "node:assert/strict";
import { WinComputerToolSchema } from "../lib/tool.ts";

test("win_computer schema is a top-level JSON object", () => {
  const schema = WinComputerToolSchema as any;
  assert.strictEqual(schema.type, "object");
  assert.strictEqual(schema.anyOf, undefined);
  assert.deepStrictEqual(schema.properties.action.enum, ["run", "call", "raw", "capabilities", "close"]);
  assert.deepStrictEqual(schema.required, ["action"]);
  assert.strictEqual(schema.properties.chain.items.type, "object");
});
