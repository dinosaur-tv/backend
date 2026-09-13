import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApp } from "./server.js";
import { loadConfig } from "./config.js";
import { GoogleCalendarService } from "./google.js";

const BOT = "test-token";

function phoneHeaders(id: number) {
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id }) });
  const key = createHmac("sha256", "WebAppData").update(BOT).digest();
  data.set("hash", createHmac("sha256", key).update([...data].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n")).digest("hex"));
  return { "x-telegram-init-data": data.toString() };
}

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dino-screens-"));
  const config = loadConfig({
    API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test",
    MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
    TELEGRAM_BOT_TOKEN: BOT, REGISTRATION_OPEN: "true", TV_REMOTE_ENABLED: "true",
  });
  const app = createApp(config, dir);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  t.mock.method(GoogleCalendarService.prototype, "eventsForNextMonth", async () => []);
  const phone = phoneHeaders(1);
  await app.inject({ method: "POST", url: "/v1/miniapp/households", headers: phone, payload: { name: "Дом" } });

  /** Pairs one more television and returns the headers it speaks with. */
  const pair = async () => {
    const started = (await app.inject({ method: "POST", url: "/v1/display/pair/start" })).json();
    assert.equal((await app.inject({ method: "POST", url: "/v1/miniapp/pair/approve", headers: phone, payload: { code: started.code } })).statusCode, 200);
    const session = (await app.inject("/v1/display/pair/wait?pairId=" + started.pairId)).json().session;
    return { authorization: "Bearer " + session };
  };
  const state = async () => (await app.inject({ url: "/v1/miniapp/state", headers: phone })).json();
  const snapshot = async (tv: { authorization: string }) => (await app.inject({ url: "/v1/display/snapshot", headers: tv })).json();
  /** Two televisions, both having said hello, and their ids as the phone sees them. */
  const twoScreens = async () => {
    const kitchen = await pair(), hall = await pair();
    await snapshot(kitchen); await snapshot(hall);
    const [first, second] = (await state()).screens;
    return { kitchen, hall, first, second };
  };
  return { app, phone, pair, state, snapshot, twoScreens };
}

test("вторая привязка не становится вторым «Телевизором»", async (t) => {
  const f = await fixture(t);
  await f.pair(); await f.pair(); await f.pair();
  assert.deepEqual((await f.state()).screens.map((screen: { label: string }) => screen.label), ["Телевизор", "Телевизор 2", "Телевизор 3"]);
});

test("команда доходит до названного экрана и только до него", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall, first } = await f.twoScreens();
  await f.app.inject({ method: "POST", url: "/v1/miniapp/tv", headers: f.phone, payload: { action: "key", key: "up", screen: first.id } });
  const kitchenView = await f.snapshot(kitchen);
  assert.equal(kitchenView.tvCommands.length, 1);
  assert.equal(kitchenView.tvCommand.key, "up");
  assert.deepEqual((await f.snapshot(hall)).tvCommands, [], "в зале пульт не нажимали");
});

test("пульт, не знающий про два экрана, командует обоими", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall } = await f.twoScreens();
  await f.app.inject({ method: "POST", url: "/v1/miniapp/tv", headers: f.phone, payload: { action: "key", key: "home" } });
  assert.equal((await f.snapshot(kitchen)).tvCommands.length, 1);
  assert.equal((await f.snapshot(hall)).tvCommands.length, 1);
});

test("музыка с одного экрана не показывается на другом", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall } = await f.twoScreens();
  await f.app.inject({ method: "POST", url: "/v1/display/now-playing", headers: kitchen, payload: { title: "Пятая симфония", artist: "Бетховен" } });

  assert.equal((await f.snapshot(kitchen)).nowPlaying.title, "Пятая симфония");
  assert.equal((await f.snapshot(hall)).nowPlaying, null);

  const after = await f.state();
  assert.equal(after.screens[0].nowPlaying.title, "Пятая симфония");
  assert.equal(after.screens[1].nowPlaying, null);
  assert.equal(after.nowPlaying.title, "Пятая симфония", "телефон без выбора показывает тот экран, где играет");
});

test("выключенный экран гаснет один, остальные светят", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall, first, second } = await f.twoScreens();
  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { tvPower: "off", screen: first.id } });
  assert.equal((await f.snapshot(kitchen)).power, "off");
  assert.equal((await f.snapshot(hall)).power, "on");

  const after = await f.state();
  assert.equal(after.screens.find((screen: { id: string }) => screen.id === first.id).power, "off");
  assert.equal(after.screens.find((screen: { id: string }) => screen.id === second.id).power, "on");
  assert.equal(after.tvPower, "on", "дом не выключен, пока горит хоть один экран");

  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { tvPower: "off", screen: second.id } });
  assert.equal((await f.state()).tvPower, "off");
});

test("выключение без имени экрана гасит весь дом", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall, first } = await f.twoScreens();
  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { tvPower: "off", screen: first.id } });
  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { tvPower: "on" } });
  assert.equal((await f.snapshot(kitchen)).power, "on", "настройка одного экрана не переживает команду всему дому");
  assert.equal((await f.snapshot(hall)).power, "on");
});

test("ответ на команду тоже называет экраны — иначе телефон теряет выбранный", async (t) => {
  const f = await fixture(t);
  const { first } = await f.twoScreens();
  for (const [url, payload] of [
    ["/v1/miniapp/tv", { action: "key", key: "up", screen: first.id }],
    ["/v1/miniapp/display", { tvPower: "off", screen: first.id }],
  ] as const) {
    const answer = (await f.app.inject({ method: url.endsWith("/tv") ? "POST" : "PATCH", url, headers: f.phone, payload })).json();
    assert.deepEqual(answer.screens.map((screen: { label: string }) => screen.label), ["Телевизор", "Телевизор 2"], url);
  }
});

test("выключенный экран остаётся выключенным, даже если он ещё ни разу не отозвался", async (t) => {
  const f = await fixture(t);
  await f.pair(); await f.pair();
  const [, second] = (await f.state()).screens;
  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { tvPower: "off", screen: second.id } });
  const after = (await f.state()).screens.find((screen: { id: string }) => screen.id === second.id);
  assert.equal(after.power, "off", "настройка живёт в доме, а не в памяти отозвавшихся экранов");
});

test("экран можно назвать, и имя видно с телефона", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const [screen] = (await f.state()).screens;
  const renamed = await f.app.inject({ method: "PATCH", url: "/v1/miniapp/households/devices/" + screen.id, headers: f.phone, payload: { label: "Кухня" } });
  assert.equal(renamed.statusCode, 200);
  assert.deepEqual((await f.state()).screens.map((item: { label: string }) => item.label), ["Кухня"]);
});

test("перезагрузку просят у одного экрана, а не у всех", async (t) => {
  const f = await fixture(t);
  const { kitchen, hall, first } = await f.twoScreens();
  await f.app.inject({ method: "PATCH", url: "/v1/miniapp/display", headers: f.phone, payload: { reloadTv: true, screen: first.id } });
  assert.equal(typeof (await f.snapshot(kitchen)).reloadAt, "string");
  assert.equal((await f.snapshot(hall)).reloadAt, undefined);
});

test("чужой экран не переименовать из другого дома", async (t) => {
  const f = await fixture(t);
  await f.pair();
  const [screen] = (await f.state()).screens;
  const stranger = phoneHeaders(2);
  await f.app.inject({ method: "POST", url: "/v1/miniapp/households", headers: stranger, payload: { name: "Чужой дом" } });
  const refused = await f.app.inject({ method: "PATCH", url: "/v1/miniapp/households/devices/" + screen.id, headers: stranger, payload: { label: "Мой" } });
  assert.equal(refused.statusCode, 404);
});
