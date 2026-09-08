import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRotation } from "./types.js";

test("tab rotation stays on and thirty seconds until the remote says otherwise", () => {
  assert.deepEqual(normalizeRotation(), { enabled: true, today: 30, tomorrow: 30, week: 30 });
  assert.deepEqual(normalizeRotation({ enabled: false, seconds: 15 }), { enabled: false, today: 15, tomorrow: 15, week: 15 });
  assert.deepEqual(normalizeRotation({ today: 45, tomorrow: 60, week: 90 }), { enabled: true, today: 45, tomorrow: 60, week: 90 });
  assert.deepEqual(normalizeRotation({ now: 10, today: 45, week: 90 }), { enabled: true, today: 45, tomorrow: 45, week: 90 });
  assert.equal(normalizeRotation({ interval: 12 }).week, 12);
  assert.equal(normalizeRotation({ today: 1 }).today, 5);
  assert.equal(normalizeRotation({ week: 400 }).week, 300);
});
