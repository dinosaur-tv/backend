import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "./server.js";
import { loadConfig } from "./config.js";
import { Households } from "./households.js";
import { GoogleCalendarService } from "./google.js";

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dino-multi-api-"));
  const config = loadConfig({ API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test", MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/", TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), TELEGRAM_WEBHOOK_SECRET: "w".repeat(32), TELEGRAM_BOT_TOKEN: "test-token", GOOGLE_CLIENT_ID: "client.example.test", GOOGLE_CLIENT_SECRET: "fixture-secret", REGISTRATION_OPEN: "true", TV_REMOTE_ENABLED: "true", PERSON_1_NAME: "Не отдавать новым домам" });
  const app = createApp(config, dir), db = new Households(dir, config);
  t.after(async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ current: { temperature_2m: 17 } })));
  t.mock.method(GoogleCalendarService.prototype, "eventsForNextMonth", async function(this: GoogleCalendarService) {
    const state = this["store"].read();
    return Object.values(state.oauth).map((value) => ({ id: "event", title: value.calendarIds[0], start: "2026-09-10T12:00:00+03:00", end: "2026-09-10T13:00:00+03:00", calendarName: "Календарь", ownerName: "Человек", allDay: false, color: "#ffffff" }));
  });
  const headers = (id: number, home?: string) => {
    const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) });
    const key = createHmac("sha256", "WebAppData").update(config.TELEGRAM_BOT_TOKEN!).digest();
    data.set("hash", createHmac("sha256", key).update([...data].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n")).digest("hex"));
    return { "x-telegram-init-data": data.toString(), ...(home ? { "x-dino-home-id": home } : {}) };
  };
  const a = (await app.inject({ method: "POST", url: "/v1/miniapp/households", headers: headers(1), payload: { name: "A" } })).json().household;
  const b = (await app.inject({ method: "POST", url: "/v1/miniapp/households", headers: headers(2), payload: { name: "B" } })).json().household;
  const ah = headers(1, a.id), bh = headers(2, b.id);
  const tv = async (h: typeof ah) => {
    const started = (await app.inject({ method: "POST", url: "/v1/display/pair/start" })).json();
    assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", headers: h, payload: { code: started.code } })).statusCode, 200);
    return { authorization: "Bearer " + (await app.inject("/v1/display/pair/wait?pairId=" + started.pairId)).json().session };
  };
  return { app, db, config, headers, a, b, ah, bh, tv };
}
test("чужой ID дома запрещён на всех приватных маршрутах, не только на экране", async (t) => {
  const f = await fixture(t), forged = f.headers(2, f.a.id);
  for (const [method, url, payload] of [
    ["GET", "/v1/miniapp/state"], ["PATCH", "/v1/miniapp/display", { theme: "sea" }],
    ["POST", "/v1/miniapp/music", { action: "pause" }], ["POST", "/v1/miniapp/tv", { action: "key", key: "home" }],
    ["POST", "/v1/miniapp/calendars/connect", { person: "misha" }], ["GET", "/v1/miniapp/calendars/misha"],
    ["PATCH", "/v1/miniapp/calendars/misha", { calendarIds: ["primary"] }], ["POST", "/v1/miniapp/calendars/disconnect", { person: "misha" }],
    ["POST", "/v1/miniapp/background", { image: "fake" }], ["GET", "/v1/miniapp/households/members"],
    ["GET", "/v1/miniapp/households/devices"], ["POST", "/v1/miniapp/households/invite"],
    ["POST", "/v1/miniapp/pair/invite"], ["POST", "/v1/miniapp/access/revoke"], ["DELETE", "/v1/miniapp/households/current"],
  ] as const) {
    const result = await f.app.inject({ method, url, headers: forged, ...(payload ? { payload } : {}) });
    assert.equal(result.statusCode, 403, method + " " + url);
  }
  assert.equal((await f.app.inject({ url: "/v1/miniapp/households", headers: f.bh })).json().households.length, 1);
  assert.equal((await f.app.inject({ url: "/v1/miniapp/state", headers: f.ah })).json().display.theme, "gallery");
});
test("кэш расписания, музыка, команды, присутствие и имена изолированы по домам", async (t) => {
  const f = await fixture(t);
  for (const home of [f.a, f.b]) f.db.state(home.id).update((s) => { s.oauth.misha = { refreshToken: "secret-" + home.name, calendarIds: ["Событие " + home.name], connectedAt: "now" }; });
  const atv = await f.tv(f.ah), btv = await f.tv(f.bh);
  await f.app.inject({ method: "POST", url: "/v1/display/now-playing", headers: atv, payload: { title: "Музыка A", artist: "Артист", isPlaying: true } });
  await f.app.inject({ method: "POST", url: "/v1/miniapp/tv", headers: f.ah, payload: { action: "key", key: "home" } });
  const [ar, br] = await Promise.all([f.app.inject({ url: "/v1/display/snapshot", headers: atv }), f.app.inject({ url: "/v1/display/snapshot", headers: btv })]);
  const a = ar.json(), b = br.json();
  assert.equal(a.days[0].events[0].title, "Событие A"); assert.equal(b.days[0].events[0].title, "Событие B");
  assert.equal(a.nowPlaying.title, "Музыка A"); assert.equal(b.nowPlaying, null);
  assert.equal(a.tvCommands.length, 1); assert.equal(b.tvCommands.length, 0);
  assert.equal(a.personLabels.misha, "Участник 1"); assert.equal("tvUrl" in a, false);
  assert.equal(ar.body.includes("secret-A"), false); assert.equal(br.body.includes("Событие A"), false);
  assert.equal((await f.app.inject({ url: "/v1/display/snapshot", headers: { ...atv, "x-dino-home-id": f.b.id } })).statusCode, 403);
});
test("чужие устройства и поддельный внутренний заголовок не обходят проверку", async (t) => {
  const f = await fixture(t), tv = await f.tv(f.ah);
  assert.equal((await f.app.inject({ url: "/v1/miniapp/state", headers: { "x-dino-home-token": tv.authorization.slice(7), "x-dino-internal": "forged" } })).statusCode, 401);
  assert.equal((await f.app.inject({ url: "/v1/miniapp/state", headers: { "x-dino-internal": "forged" } })).statusCode, 401);
  const invitation = (await f.app.inject({ method: "POST", url: "/v1/miniapp/pair/invite", headers: f.ah })).json();
  const token = (await f.app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", payload: { code: invitation.code } })).json().homeToken;
  assert.equal((await f.app.inject({ url: "/v1/miniapp/state", headers: { "x-dino-home-token": token, "x-dino-home-id": f.b.id } })).statusCode, 403);
});
test("ссылка на личный фон подписана вместе с ID дома", async (t) => {
  const f = await fixture(t);
  const image = "data:image/jpeg;base64," + Buffer.from([255, 216, 255, 219, 0, 1, 0, 0, 0]).toString("base64");
  const upload = await f.app.inject({ method: "POST", url: "/v1/miniapp/background", headers: f.ah, payload: { image } });
  assert.equal(upload.statusCode, 200);
  const url = new URL(upload.json().display.backgroundUrl);
  assert.equal((await f.app.inject(url.pathname + url.search)).statusCode, 200);
  assert.equal((await f.app.inject((url.pathname + url.search).replace(f.a.id, f.b.id))).statusCode, 401);
  await f.app.inject({ method: "DELETE", url: "/v1/miniapp/households/current", headers: f.ah });
  assert.equal((await f.app.inject(url.pathname + url.search)).statusCode, 404);
});
test("Google callback нельзя направить в другой дом", async (t) => {
  const f = await fixture(t);
  const response = await f.app.inject({ method: "POST", url: "/v1/miniapp/calendars/connect", headers: f.ah, payload: { person: "misha" } });
  assert.equal(response.statusCode, 200);
  const state = new URL(response.json().url).searchParams.get("state")!;
  assert.equal(state.startsWith(f.a.id + "."), true);
  const callback = await f.app.inject("/oauth/google/callback?code=fake&state=" + state.replace(f.a.id, f.b.id));
  assert.equal(callback.statusCode, 400);
  assert.deepEqual(f.db.state(f.b.id).read().oauth, {});
});
test("участник подключает свободный календарь, но не управляет чужим или домом", async (t) => {
  const f = await fixture(t);
  const invite = f.db.invite("member", f.db.access("1", f.a.id)); f.db.join("3", invite.code);
  const member = f.headers(3, f.a.id);
  f.db.state(f.a.id).update((s) => { s.oauth.misha = { userId: "1", refreshToken: "owner-secret", calendarIds: [], connectedAt: "now" }; });
  assert.equal((await f.app.inject({ method: "POST", url: "/v1/miniapp/calendars/connect", headers: member, payload: { person: "misha" } })).statusCode, 403);
  assert.equal((await f.app.inject({ method: "POST", url: "/v1/miniapp/calendars/connect", headers: member, payload: { person: "natasha" } })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "POST", url: "/v1/miniapp/households/invite", headers: member })).statusCode, 403);
  assert.equal((await f.app.inject({ method: "POST", url: "/v1/miniapp/access/revoke", headers: member })).statusCode, 403);
  await f.app.inject({ method: "DELETE", url: "/v1/miniapp/households/members/3", headers: f.ah });
  assert.equal((await f.app.inject({ url: "/v1/miniapp/state", headers: member })).statusCode, 403);
});
test("бот принимает новых людей, но команды исполняет только в их активном доме", async (t) => {
  const f = await fixture(t), webhook = (id: number, text: string) => f.app.inject({ method: "POST", url: "/v1/telegram/webhook", headers: { "x-telegram-bot-api-secret-token": f.config.TELEGRAM_WEBHOOK_SECRET }, payload: { message: { chat: { id }, from: { id }, text } } });
  assert.match((await webhook(3, "/start")).json().text, /создай дом/i);
  assert.equal(f.db.list("3").length, 0);
  await webhook(1, "/tomorrow");
  assert.equal(f.db.state(f.a.id).read().display.mode, "TOMORROW"); assert.equal(f.db.state(f.b.id).read().display.mode, "TODAY");
  const another = f.db.create("1", "A2"); await webhook(1, "/week");
  assert.equal(f.db.state(another.id).read().display.mode, "WEEK"); assert.equal(f.db.state(f.a.id).read().display.mode, "TOMORROW");
  assert.equal((await f.app.inject({ method: "POST", url: "/v1/telegram/webhook", payload: {} })).statusCode, 401);
});
