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

/** claimLogin throws on a bad code; the tests care about the status, not the stack. */
function refusal(homes: Households, code: string): number | undefined {
  try {
    homes.claimLogin(code);
    return undefined;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
}

test("код из бота открывает сессию того же человека", (t) => {
  const { homes } = fixture(t);
  const home = homes.create("777", "Мой дом");
  const { code, expiresIn } = homes.issueLoginCode("777");

  assert.match(code, /^\d{8}$/, "восемь цифр отличают вход от кода экрана и приглашения");
  assert.equal(expiresIn, 300);

  const { token } = homes.claimLogin(code) as { token: string };
  assert.equal(homes.session(token), "777");
  assert.deepEqual(homes.list("777").map((h) => h.id), [home.id]);
  assert.equal(homes.access("777").role, "owner");
});

test("код одноразовый, а подобранный не подходит", (t) => {
  const { homes } = fixture(t);
  const { code } = homes.issueLoginCode("777");
  homes.claimLogin(code);
  assert.equal(refusal(homes, code), 404, "второй раз тем же кодом не войти");
  assert.equal(refusal(homes, "00000000"), 404);
});

test("код живёт пять минут", (t) => {
  const { homes, advance } = fixture(t);
  const { code } = homes.issueLoginCode("777");
  advance(301_000);
  assert.equal(refusal(homes, code), 404);
});

test("новый код отменяет предыдущий: в чате всегда действует последний", (t) => {
  const { homes } = fixture(t);
  const first = homes.issueLoginCode("777").code;
  const second = homes.issueLoginCode("777").code;
  assert.notEqual(first, second);
  assert.equal(refusal(homes, first), 404, "старый код в переписке уже не работает");
  assert.equal(homes.session((homes.claimLogin(second) as { token: string }).token), "777");
});

test("код одного человека не даёт доступа к дому другого", (t) => {
  const { homes } = fixture(t);
  homes.create("777", "Мой дом");
  const { code } = homes.issueLoginCode("999");
  const { token } = homes.claimLogin(code) as { token: string };
  assert.equal(homes.session(token), "999");
  assert.deepEqual(homes.list("999"), [], "у него своих домов нет");
});

test("выход закрывает одну сессию, остальные живут", (t) => {
  const { homes } = fixture(t);
  const one = (homes.claimLogin(homes.issueLoginCode("777").code) as { token: string }).token;
  const two = (homes.claimLogin(homes.issueLoginCode("777").code) as { token: string }).token;
  homes.signOut(one);
  assert.equal(homes.session(one), undefined);
  assert.equal(homes.session(two), "777", "второе устройство остаётся внутри");
});

test("выдуманный токен сессии не пускает", (t) => {
  const { homes } = fixture(t);
  assert.equal(homes.session("подобранный-токен"), undefined);
  assert.equal(homes.session(undefined), undefined);
});
