import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OAuthStates } from "./oauth-state.js";
import { EncryptedStore } from "./store.js";

test("OAuth state is opaque, encrypted at rest, one-time and survives restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dino-oauth-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "state.enc");
  const key = randomBytes(32).toString("base64");
  const store = new EncryptedStore(path, key);
  const first = new OAuthStates(store, () => 1000);
  const token = first.issue("misha");
  assert.equal(token.includes("misha"), false);
  assert.equal(readFileSync(path, "utf8").includes(token), false);
  const restored = new OAuthStates(new EncryptedStore(path, key), () => 1001);
  assert.equal(restored.consume(token).person, "misha");
  assert.throws(() => restored.consume(token), { statusCode: 400 });
});

test("expired, forged and cancelled authorizations cannot reconnect an account", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dino-oauth-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new EncryptedStore(join(dir, "state.enc"), randomBytes(32).toString("base64"));
  let now = 1000;
  const states = new OAuthStates(store, () => now);
  assert.throws(() => states.consume("forged"), { statusCode: 400 });
  const expired = states.issue("natasha");
  now += 900_000;
  assert.throws(() => states.consume(expired), { statusCode: 400 });
  const token = states.issue("misha");
  const pending = states.consume(token);
  assert.equal(states.isCurrent(pending.person, pending.version), true);
  states.invalidate("misha");
  assert.equal(states.isCurrent(pending.person, pending.version), false);
});
