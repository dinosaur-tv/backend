import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

function fixture(t: { after: (fn: () => Promise<void>) => void }, remote = "false") {
  const dir = mkdtempSync(join(tmpdir(), "dino-api-test-"));
  const config = loadConfig({
    API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test",
    MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), DEVICE_TOKEN: "d".repeat(40),
    TELEGRAM_WEBHOOK_SECRET: "w".repeat(32), OAUTH_FORWARD_URL: "http://127.0.0.1:8003/api/callback",
    TELEGRAM_BOT_TOKEN: "test-bot-token", TELEGRAM_ALLOWED_USER_IDS: "1", TV_REMOTE_ENABLED: remote,
  });
  const app = createApp(config, dir);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1 }) });
  const secret = createHmac("sha256", "WebAppData").update(config.TELEGRAM_BOT_TOKEN!).digest();
  const check = [...data].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  data.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return { app, headers: { "x-telegram-init-data": data.toString() } };
}

test("anonymous TV cannot bootstrap access to the owner's home", async (t) => {
  const { app } = fixture(t);
  const started = (await app.inject({ method: "POST", url: "/v1/display/pair/start" })).json();
  const approve = await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", payload: { code: started.code } });
  assert.equal(approve.statusCode, 404);
  assert.equal((await app.inject("/v1/display/pair/wait?pairId=" + started.pairId)).json().status, "waiting");
  assert.equal((await app.inject("/v1/miniapp/state")).statusCode, 401);
  assert.equal((await app.inject("/v1/display/snapshot")).statusCode, 401);
});
test("owner approves TV, separate phone invitation is single-use, revocation works", async (t) => {
  const { app, headers } = fixture(t);
  const started = (await app.inject({ method: "POST", url: "/v1/display/pair/start" })).json();
  const approve = await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", headers, payload: { code: started.code } });
  assert.equal(approve.statusCode, 200);
  assert.equal((await app.inject("/v1/display/pair/wait?pairId=" + started.pairId)).json().status, "ready");
  const invite = (await app.inject({ method: "POST", url: "/v1/miniapp/pair/invite", headers })).json();
  const phone = await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", payload: { code: invite.code } });
  assert.equal(phone.statusCode, 200);
  const phoneHeaders = { "x-dino-home-token": phone.json().homeToken };
  assert.equal((await app.inject({ url: "/v1/miniapp/state", headers: phoneHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", payload: { code: invite.code } })).statusCode, 404);
  await app.inject({ method: "POST", url: "/v1/miniapp/access/revoke", headers });
  assert.equal((await app.inject({ url: "/v1/miniapp/state", headers: phoneHeaders })).statusCode, 401);
});
test("feature flag denies direct remote API calls, not just the UI", async (t) => {
  const { app, headers } = fixture(t);
  assert.equal((await app.inject({ url: "/v1/miniapp/state", headers })).json().features.tvRemote, false);
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/tv", headers, payload: { action: "key", key: "ok" } })).statusCode, 403);
});
test("enabled remote accepts authorized commands only", async (t) => {
  const { app, headers } = fixture(t, "true");
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/tv", headers, payload: { action: "key", key: "ok" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/tv", payload: { action: "key", key: "ok" } })).statusCode, 401);
});
test("pair-code guessing is throttled despite forged forwarded headers", async (t) => {
  const { app } = fixture(t);
  for (let i = 0; i < 5; i++) await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", headers: { "x-forwarded-for": "192.0.2." + i }, payload: { code: "000000" } });
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", payload: { code: "000000" } })).statusCode, 429);
});
test("OAuth and private backgrounds cannot be accessed anonymously", async (t) => {
  const { app } = fixture(t);
  assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/calendars/connect", payload: { person: "misha" } })).statusCode, 401);
  assert.equal((await app.inject("/oauth/google/start?person=misha&key=legacy")).statusCode, 410);
  assert.equal((await app.inject("/v1/media/background/12345678?expires=1&signature=bad")).statusCode, 401);
});

test("a Google callback for a neighbouring service is handed over, not read as a home", async (t) => {
  const { app } = fixture(t);
  const handed = await app.inject("/oauth/google/callback?code=abc&state=6f1b0c2e-1111-4222-8333-444455556666");
  assert.equal(handed.statusCode, 302);
  assert.equal(handed.headers.location, "http://127.0.0.1:8003/api/callback?code=abc&state=6f1b0c2e-1111-4222-8333-444455556666");
  const mine = await app.inject("/oauth/google/callback?code=abc&state=6f1b0c2e-1111-4222-8333-444455556666.token");
  assert.equal(mine.statusCode, 404);
});
