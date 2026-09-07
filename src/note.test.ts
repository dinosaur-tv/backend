import assert from "node:assert/strict";
import test from "node:test";
import { liveNote, noteExpiresAt, parseNoteMinutes } from "./types.js";

test("note expiry follows the chosen duration", () => {
  const now = Date.parse("2026-09-07T21:00:00.000Z");
  assert.equal(noteExpiresAt(15, now), "2026-09-07T21:15:00.000Z");
  assert.equal(noteExpiresAt(120, now), "2026-09-07T23:00:00.000Z");
  assert.equal(parseNoteMinutes(), 60);
  assert.equal(parseNoteMinutes(45), 45);
  assert.throws(() => parseNoteMinutes(7), /сколько держать/);
});

test("drops an expired living-room note", () => {
  assert.equal(liveNote(undefined), undefined);
  assert.equal(liveNote({ text: "хлеб", expiresAt: "2026-09-07T20:00:00.000Z" }, Date.parse("2026-09-07T21:00:00.000Z")), undefined);
  assert.deepEqual(liveNote({ text: "хлеб", expiresAt: "2026-09-07T22:00:00.000Z" }, Date.parse("2026-09-07T21:00:00.000Z")), {
    text: "хлеб",
    expiresAt: "2026-09-07T22:00:00.000Z",
  });
});
