import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRotation } from "./types.js";

test("tab rotation stays on and thirty seconds until the remote says otherwise", () => {
  assert.deepEqual(normalizeRotation(), { enabled: true, now: 30, today: 30, week: 30 });
  assert.deepEqual(normalizeRotation({ enabled: false, seconds: 15 }), { enabled: false, now: 15, today: 15, week: 15 });
  assert.equal(normalizeRotation({ now: 10, today: 45, week: 90 }).today, 45);
  assert.equal(normalizeRotation({ interval: 12 }).week, 12);
  assert.equal(normalizeRotation({ now: 1 }).now, 5);
  assert.equal(normalizeRotation({ week: 400 }).week, 300);
});
