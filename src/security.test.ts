import assert from "node:assert/strict";
import test from "node:test";
import { AttemptLimiter, mediaAllowed, requireRemoteEnabled, signMedia } from "./security.js";
test("pairing limits expire and isolate clients", () => {
  const limiter = new AttemptLimiter();
  assert.equal(limiter.allow("a", 1, 100, 0), true);
  assert.equal(limiter.allow("a", 1, 100, 1), false);
  assert.equal(limiter.allow("b", 1, 100, 1), true);
  assert.equal(limiter.allow("a", 1, 100, 100), true);
});
test("remote is denied unless explicitly enabled", () => {
  assert.throws(() => requireRemoteEnabled(false), { statusCode: 403 });
  assert.doesNotThrow(() => requireRemoteEnabled(true));
});
test("background links expire and cannot be used for another photo", () => {
  const signature = signMedia("photo", 2000, "key");
  assert.equal(mediaAllowed("photo", 2000, signature, "key", 1000), true);
  assert.equal(mediaAllowed("other", 2000, signature, "key", 1000), false);
  assert.equal(mediaAllowed("photo", 2000, signature, "key", 2000), false);
  assert.equal(mediaAllowed("photo", 2000, signature, "other", 1000), false);
});
