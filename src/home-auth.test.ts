import assert from "node:assert/strict";
import test from "node:test";
import { hashHomeToken, homeTokenAllowed, issueHomeToken, rememberHomeToken } from "./home-auth.js";

test("accepts a freshly issued home remote token", () => {
  const issued = issueHomeToken();
  assert.equal(homeTokenAllowed(issued.token, [issued.hash]), true);
  assert.equal(homeTokenAllowed("nope-nope-nope-nope", [issued.hash]), false);
});

test("keeps the latest phone tokens without duplicates", () => {
  const first = hashHomeToken("one-token-value-xx");
  const second = hashHomeToken("two-token-value-xx");
  const hashes = rememberHomeToken(rememberHomeToken([first], first), second, 2);
  assert.deepEqual(hashes, [first, second]);
});
