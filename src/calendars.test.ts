import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config.js";
import { GoogleCalendarService } from "./google.js";
import { Households } from "./households.js";
import { calendarColors, defaultPlace, normalizeCalendars, type StoredState } from "./types.js";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dino-calendars-"));
  const config = loadConfig({
    API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test",
    MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
    GOOGLE_CLIENT_ID: "client.example.test", GOOGLE_CLIENT_SECRET: "fixture-secret", REGISTRATION_OPEN: "true",
  });
  const homes = new Households(dir, config);
  t.after(() => { homes.close(); rmSync(dir, { recursive: true, force: true }); });
  const home = homes.create("777", "Дом");
  const store = homes.state(home.id);
  return { homes, home, store, calendars: new GoogleCalendarService(config, store, home.id) };
}

function blank(): StoredState {
  return { oauth: {}, display: { mode: "TODAY", theme: "gallery", mood: "home", privacy: false, showWeather: true, showCalendar: true, rotation: { enabled: true, today: 30, tomorrow: 30, week: 30 }, place: defaultPlace() } };
}

test("дом держит больше двух календарей, и каждый со своей подписью", (t) => {
  const { store, calendars } = fixture(t);
  for (const label of ["Миша", "Наташа", "Бабушка", "Школа"]) {
    const url = new URL(calendars.authorizationUrl(undefined, "777", label));
    const state = url.searchParams.get("state")!;
    store.update((stored) => {
      const person = stored.oauthStates![[...Object.keys(stored.oauthStates!)].at(-1)!].person;
      stored.oauth[person] = { refreshToken: "t", calendarIds: [], connectedAt: "now", label, color: undefined };
    });
    assert.equal(typeof state, "string");
  }
  const accounts = calendars.accounts();
  assert.deepEqual(accounts.map((account) => account.label), ["Миша", "Наташа", "Бабушка", "Школа"]);
  assert.equal(new Set(accounts.map((account) => account.color)).size, 4, "соседние календари не сливаются на экране");
  assert.equal(new Set(accounts.map((account) => account.id)).size, 4, "у каждого свой идентификатор");
});

test("подпись меняется, не трогая подключение", (t) => {
  const { store, calendars } = fixture(t);
  store.update((stored) => { stored.oauth.misha = { refreshToken: "секрет", calendarIds: ["personal"], connectedAt: "тогда" }; });
  calendars.rename("misha", "Бабушкин календарь");
  const connection = store.read().oauth.misha!;
  assert.equal(connection.label, "Бабушкин календарь");
  assert.equal(connection.refreshToken, "секрет");
  assert.deepEqual(connection.calendarIds, ["personal"]);
});

test("нельзя переименовать то, чего уже нет", (t) => {
  const { calendars } = fixture(t);
  assert.throws(() => calendars.rename("misha", "Кто-то"), (error: { statusCode?: number }) => error.statusCode === 404);
});

test("дом, записанный до подписей на карточках, получает их при чтении", () => {
  const state = blank();
  state.personLabels = { misha: "Алексей", natasha: "Анна" };
  state.oauth.misha = { refreshToken: "a", calendarIds: [], connectedAt: "now" };
  state.oauth.natasha = { refreshToken: "b", calendarIds: [], connectedAt: "now" };
  normalizeCalendars(state);
  assert.equal(state.oauth.misha!.label, "Алексей");
  assert.equal(state.oauth.natasha!.label, "Анна");
  assert.equal(state.oauth.misha!.color, calendarColors[0]);
  assert.equal(state.oauth.natasha!.color, calendarColors[1]);
});

test("самый первый дом держал имена в настройках сервера — они тоже переезжают", () => {
  const state = blank();
  state.oauth.misha = { refreshToken: "a", calendarIds: [], connectedAt: "now" };
  normalizeCalendars(state, { misha: "Из окружения" });
  assert.equal(state.oauth.misha!.label, "Из окружения");
});

test("новый календарь берёт свободный цвет, а не чужой", () => {
  const state = blank();
  state.oauth.misha = { refreshToken: "a", calendarIds: [], connectedAt: "now", label: "Раз", color: calendarColors[2] };
  state.oauth.abc123 = { refreshToken: "b", calendarIds: [], connectedAt: "now", label: "Два" };
  normalizeCalendars(state);
  assert.equal(state.oauth.abc123!.color, calendarColors[0]);
  assert.notEqual(state.oauth.abc123!.color, state.oauth.misha!.color);
});

test("подписи доходят до дома через обычное чтение состояния", (t) => {
  const { homes, home } = fixture(t);
  homes.state(home.id).update((stored) => { stored.personLabels = { misha: "Алексей" }; stored.oauth.misha = { refreshToken: "a", calendarIds: [], connectedAt: "now" }; });
  assert.equal(homes.state(home.id).read().oauth.misha!.label, "Алексей");
});
