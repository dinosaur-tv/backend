import assert from "node:assert/strict";
import test from "node:test";
import { PairingDesk } from "./pairing.js";

test("hands the television a session after the phone confirms the code", () => {
  const desk = new PairingDesk();
  const started = desk.start(1_000);
  assert.equal(desk.status(started.pairId, 1_000).status, "waiting");
  assert.equal(desk.approve(started.code, "tv-session", 1_000), true);
  assert.deepEqual(desk.status(started.pairId, 1_000), { status: "ready", session: "tv-session" });
});

test("expires an unused pairing", () => {
  const desk = new PairingDesk();
  const started = desk.start(1_000);
  assert.equal(desk.status(started.pairId, 1_000 + 11 * 60 * 1000).status, "expired");
});

test("keeps one unused code so a second phone can join", () => {
  const desk = new PairingDesk();
  const first = desk.start(1_000);
  const second = desk.start(1_000);
  assert.equal(desk.waitingCode(1_000), second.code);
  assert.equal(desk.status(first.pairId, 1_000).status, "expired");
  assert.equal(desk.approve(second.code, "tv-session", 1_000), true);
  assert.equal(desk.waitingCode(1_000), undefined);
});
