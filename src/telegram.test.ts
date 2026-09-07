import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifiedTelegramWebAppUserId } from "./telegram.js";

const token = "test-token";
const now = 1_800_000_000;

function signedPayload(values: Record<string, string>): string {
  const checkString = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

test("accepts a fresh signed Telegram Mini App user", () => {
  const payload = signedPayload({ auth_date: String(now), query_id: "query", user: '{"id":200109375}' });
  assert.equal(verifiedTelegramWebAppUserId(payload, token, now), 200109375);
});

test("rejects a modified or stale Telegram Mini App payload", () => {
  const payload = signedPayload({ auth_date: String(now), user: '{"id":200109375}' });
  assert.equal(verifiedTelegramWebAppUserId(payload.replace("200109375", "42"), token, now), undefined);
  assert.equal(verifiedTelegramWebAppUserId(payload, token, now + 86_401), undefined);
});
