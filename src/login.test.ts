import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config.js";
import { Households } from "./households.js";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "dino-login-"));
  const config = loadConfig({
    API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test",
    MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/",
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), TELEGRAM_WEBHOOK_SECRET: "w".repeat(32),
    REGISTRATION_OPEN: "true",
  });
  let now = Date.now();
  const homes = new Households(dir, config, () => now);
  t.after(() => { homes.close(); rmSync(dir, { recursive: true, force: true }); });
  return { homes, advance: (ms: number) => { now += ms; } };
}

test("ссылка из бота превращается в сессию, и второй раз её забрать нельзя", (t) => {
  const { homes } = fixture(t);
  const { nonce } = homes.startLogin();

  assert.deepEqual(homes.claimLogin(nonce), { status: "waiting" });
  assert.equal(homes.bindLogin(nonce, "777"), true);

  const claimed = homes.claimLogin(nonce);
  assert.equal(claimed.status, "ready");
  assert.equal(homes.session(claimed.token), "777");

  // Одноразовость: повторный заход по той же ссылке ничего не даёт.
  assert.deepEqual(homes.claimLogin(nonce), { status: "expired" });
});

test("чужой или выдуманный nonce не открывает сессию", (t) => {
  const { homes } = fixture(t);
  homes.startLogin();
  assert.equal(homes.bindLogin("выдуманный-nonce-которого-нет", "777"), false);
  assert.deepEqual(homes.claimLogin("выдуманный-nonce-которого-нет"), { status: "expired" });
  assert.equal(homes.session("подобранный-токен"), undefined);
  assert.equal(homes.session(undefined), undefined);
});

test("ссылка живёт пять минут и после этого мертва", (t) => {
  const { homes, advance } = fixture(t);
  const { nonce, expiresIn } = homes.startLogin();
  assert.equal(expiresIn, 300);
  advance(301_000);
  assert.equal(homes.bindLogin(nonce, "777"), false);
  assert.deepEqual(homes.claimLogin(nonce), { status: "expired" });
});

test("вход даёт того же человека, что и мини-апп: дома и роли общие", (t) => {
  const { homes } = fixture(t);
  const home = homes.create("777", "Мой дом");
  const { nonce } = homes.startLogin();
  homes.bindLogin(nonce, "777");
  const { token } = homes.claimLogin(nonce) as { token: string };

  const userId = homes.session(token)!;
  assert.equal(userId, "777");
  assert.deepEqual(homes.list(userId).map((h) => h.id), [home.id]);
  assert.equal(homes.access(userId).role, "owner");
});

test("выход закрывает именно эту сессию, остальные живут", (t) => {
  const { homes } = fixture(t);
  const first = homes.startLogin();
  homes.bindLogin(first.nonce, "777");
  const one = (homes.claimLogin(first.nonce) as { token: string }).token;

  const second = homes.startLogin();
  homes.bindLogin(second.nonce, "777");
  const two = (homes.claimLogin(second.nonce) as { token: string }).token;

  homes.signOut(one);
  assert.equal(homes.session(one), undefined, "телефон, с которого вышли");
  assert.equal(homes.session(two), "777", "второе устройство остаётся внутри");
});
