import assert from "node:assert/strict";
import test from "node:test";
import { PairingDesk } from "./pairing.js";
import type { StoredPairing } from "./types.js";

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

test("reuses the waiting code until it expires or is approved", () => {
  const desk = new PairingDesk();
  const first = desk.start(1_000);
  const second = desk.start(1_000);
  assert.equal(second.pairId, first.pairId);
  assert.equal(second.code, first.code);
  assert.equal(desk.waitingCode(1_000), first.code);
  assert.equal(desk.approve(first.code, "tv-session", 1_000), true);
  assert.equal(desk.waitingCode(1_000), undefined);
  const third = desk.start(1_000);
  assert.notEqual(third.code, first.code);
  assert.equal(desk.waitingCode(1_000), third.code);
});

test("lets a second phone reuse the same code before it expires", () => {
  const desk = new PairingDesk();
  const started = desk.start(1_000);
  assert.equal(desk.approve(started.code, "tv-session", 1_000), true);
  assert.equal(desk.approve(started.code, "tv-session", 2_000), true);
  assert.equal(desk.approve(started.code, "tv-session", 1_000 + 11 * 60 * 1000), false);
});

test("restores an open code after a backend restart", () => {
  let saved: StoredPairing[] = [];
  const first = new PairingDesk({
    load: () => saved,
    save: (pairings) => {
      saved = pairings;
    },
  });
  const started = first.start(1_000);
  const restored = new PairingDesk({
    load: () => saved,
    save: (pairings) => {
      saved = pairings;
    },
  });
  assert.equal(restored.waitingCode(1_000), started.code);
  assert.equal(restored.approve(started.code, "tv-session", 1_000), true);
});
