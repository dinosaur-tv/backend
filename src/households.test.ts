import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { loadConfig } from "./config.js";
import { Households } from "./households.js";
import { EncryptedStore } from "./store.js";
import { OAuthStates } from "./oauth-state.js";

function fixture(t: TestContext, overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dino-homes-test-"));
  const config = loadConfig({ API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test", MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test/console/", TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), TELEGRAM_WEBHOOK_SECRET: "w".repeat(32), REGISTRATION_OPEN: "true", ...overrides });
  let now = Date.now();
  let db = new Households(dir, config, () => now);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, config, get db() { return db; }, advance(ms: number) { now += ms; }, restart() { db.close(); db = new Households(dir, config, () => now); } };
}

test("два дома: отдельное состояние, членство и откат неудачной записи", (t) => {
  const f = fixture(t), a = f.db.create("1", "A"), b = f.db.create("2", "B");
  f.db.state(a.id).update((s) => { s.display.theme = "forest"; });
  assert.equal(f.db.state(b.id).read().display.theme, "gallery");
  assert.throws(() => f.db.access("2", a.id), { statusCode: 403 });
  assert.throws(() => f.db.state(a.id).update((s) => { s.display.theme = "sea"; throw new Error("rollback"); }));
  assert.equal(f.db.state(a.id).read().display.theme, "forest");
  f.restart(); assert.equal(f.db.state(a.id).read().display.theme, "forest");
});
test("шифрование связано с домом: перестановка записей не раскрывает данные", (t) => {
  const f = fixture(t), a = f.db.create("1", "A"), b = f.db.create("2", "B");
  f.db.state(a.id).update((s) => { s.oauth.misha = { refreshToken: "private-refresh-token-fixture", calendarIds: ["private-calendar-fixture"], connectedAt: "now" }; });
  const raw = readFileSync(join(f.dir, "households.sqlite"));
  assert.equal(raw.includes(Buffer.from("private-refresh-token-fixture")), false);
  assert.equal(raw.includes(Buffer.from("private-calendar-fixture")), false);
  const connection = new DatabaseSync(join(f.dir, "households.sqlite"));
  try { connection.prepare("UPDATE homes SET state=(SELECT state FROM homes WHERE id=?) WHERE id=?").run(a.id, b.id); }
  finally { connection.close(); }
  assert.throws(() => f.db.state(b.id).read());
});
test("назначения кодов не смешиваются; выдача ТВ атомарная и не меняет чужой дом", (t) => {
  const f = fixture(t), a = f.db.create("1", "A"), b = f.db.create("2", "B");
  const auth = f.db.access("1", a.id), tv = f.db.invite("tv"), phone = f.db.invite("phone", auth), member = f.db.invite("member", auth);
  assert.match(tv.code, /^\d{6}$/); assert.match(phone.code, /^\d{10}$/);
  assert.throws(() => f.db.approve(tv.code), { statusCode: 404 });
  assert.throws(() => f.db.join("2", phone.code), { statusCode: 404 });
  assert.throws(() => f.db.approve(member.code), { statusCode: 404 });
  assert.equal(f.db.wait(phone.pairId).status, "expired");
  f.db.approve(tv.code, auth);
  assert.throws(() => f.db.approve(tv.code, f.db.access("2", b.id)), { statusCode: 404 });
  const token = f.db.wait(tv.pairId).session!;
  assert.equal(f.db.device(token, "tv").homeId, a.id);
  assert.throws(() => f.db.device(token, "phone"), { statusCode: 401 });
  f.restart(); assert.equal(f.db.wait(tv.pairId).session, token);
  const phoneToken = f.db.approve(phone.code).homeToken!;
  assert.equal(f.db.device(phoneToken, "phone").homeId, a.id);
  assert.throws(() => f.db.device(phoneToken, "tv"), { statusCode: 401 });
  assert.throws(() => f.db.approve(phone.code), { statusCode: 404 });
});
test("отзыв одного устройства не отключает соседнее или чужой дом", (t) => {
  const f = fixture(t), a = f.db.create("1", "A"), b = f.db.create("2", "B");
  const aa = f.db.access("1", a.id), bb = f.db.access("2", b.id);
  const token = (auth: typeof aa) => f.db.approve(f.db.invite("phone", auth).code).homeToken!;
  const a1 = token(aa), a2 = token(aa), b1 = token(bb);
  const id = f.db.device(a1, "phone").deviceId!;
  f.db.revokeDevice(bb, id); assert.equal(f.db.device(a1, "phone").homeId, a.id);
  f.db.revokeDevice(aa, id); assert.throws(() => f.db.device(a1, "phone"));
  assert.equal(f.db.device(a2, "phone").homeId, a.id);
  f.db.revokeAll(aa); assert.throws(() => f.db.device(a2, "phone"));
  assert.equal(f.db.device(b1, "phone").homeId, b.id);
});
test("участник не становится владельцем; отзыв членства отзывает его телефон и OAuth", (t) => {
  const f = fixture(t), home = f.db.create("1", "A"), owner = f.db.access("1", home.id);
  const invite = f.db.invite("member", owner); f.db.join("2", invite.code);
  assert.throws(() => f.db.join("3", invite.code));
  const member = f.db.access("2", home.id);
  assert.equal(member.role, "member"); assert.throws(() => f.db.owner(member), { statusCode: 403 });
  assert.throws(() => f.db.invite("member", member), { statusCode: 403 });
  assert.throws(() => f.db.delete(member), { statusCode: 403 });
  const phone = f.db.approve(f.db.invite("phone", member).code).homeToken!;
  const state = new OAuthStates(f.db.state(home.id)); const pending = state.issue("natasha", "2");
  f.db.state(home.id).update((s) => { s.oauth.natasha = { userId: "2", refreshToken: "member-secret", calendarIds: [], connectedAt: "now" }; });
  f.db.removeMember(owner, "2");
  assert.throws(() => f.db.device(phone, "phone")); assert.throws(() => f.db.access("2", home.id));
  assert.throws(() => state.consume(pending)); assert.equal(f.db.state(home.id).read().oauth.natasha, undefined);
});
test("OAuth state нельзя перенести в другой дом или повторить", (t) => {
  const f = fixture(t), a = f.db.create("1", "A"), b = f.db.create("2", "B");
  const aa = new OAuthStates(f.db.state(a.id), undefined, a.id), bb = new OAuthStates(f.db.state(b.id), undefined, b.id);
  const token = aa.issue("misha", "1");
  assert.throws(() => bb.consume(token.replace(a.id, b.id)), { statusCode: 400 });
  assert.throws(() => bb.consume(token), { statusCode: 400 });
  const pending = aa.consume(token); assert.equal(pending.userId, "1");
  f.db.revokeAll(f.db.access("1", a.id)); assert.equal(aa.isCurrent("misha", pending.version), false);
});
test("приглашения и устройства истекают; квоты ограничивают регистрацию", (t) => {
  const f = fixture(t, { MAX_HOUSEHOLDS: "1" }), home = f.db.create("1", "A");
  assert.throws(() => f.db.create("2", "B"), { statusCode: 503 });
  const auth = f.db.access("1", home.id), invitation = f.db.invite("phone", auth);
  const tv = f.db.invite("tv"); f.db.approve(tv.code, auth); const token = f.db.wait(tv.pairId).session!;
  f.advance(600_001); assert.throws(() => f.db.approve(invitation.code)); assert.equal(f.db.wait(tv.pairId).status, "expired");
  f.advance(365 * 86400_000); assert.throws(() => f.db.device(token, "tv"));
});
test("закрытая регистрация не отменяет приглашения и не создаёт дома автоматически", (t) => {
  const f = fixture(t, { REGISTRATION_OPEN: "false", TELEGRAM_ALLOWED_USER_IDS: "1" });
  assert.throws(() => f.db.create("2", "B"), { statusCode: 403 });
  const owner = f.db.access("1"), invitation = f.db.invite("member", owner);
  assert.equal(f.db.join("2", invitation.code).homeId, owner.homeId);
  assert.equal(f.db.list("3").length, 0);
});
test("удалённый дом не восстанавливается старой миграцией; новые ID из env не получают доступ", (t) => {
  const f = fixture(t, { TELEGRAM_ALLOWED_USER_IDS: "1,2", DEVICE_TOKEN: "d".repeat(40) });
  const legacy = f.db.access("1");
  assert.equal(f.db.device(f.config.DEVICE_TOKEN, "tv").homeId, legacy.homeId);
  f.config.allowedTelegramUsers.add("3"); f.restart(); assert.equal(f.db.list("3").length, 0);
  f.db.delete(f.db.access("1")); f.restart();
  assert.equal(f.db.list("1").length, 0); assert.equal(f.db.list("2").length, 0);
  assert.throws(() => f.db.device(f.config.DEVICE_TOKEN, "tv"));
});
test("перенос существующих календарей не изменяет исходный файл и не отдаёт их новому пользователю", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dino-migration-test-")), key = randomBytes(32).toString("base64");
  const path = join(dir, "state.enc"), old = new EncryptedStore(path, key);
  old.update((s) => { s.tvSession = "old-tv-secret"; s.homeTokens = ["old-phone-hash"]; s.oauth.misha = { refreshToken: "old-google-token", calendarIds: ["personal-calendar"], connectedAt: "now" }; });
  const before = readFileSync(path);
  const config = loadConfig({ API_DOMAIN: "api.example.test", PUBLIC_BASE_URL: "https://api.example.test", MINI_APP_ORIGIN: "https://home.example.test", TELEGRAM_WEB_APP_URL: "https://home.example.test", TOKEN_ENCRYPTION_KEY: key, TELEGRAM_WEBHOOK_SECRET: "w".repeat(32), TELEGRAM_ALLOWED_USER_IDS: "1,2", REGISTRATION_OPEN: "true" });
  const db = new Households(dir, config);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.deepEqual(readFileSync(path), before);
  assert.equal(db.state(db.access("2").homeId).read().oauth.misha?.refreshToken, "old-google-token");
  assert.equal(db.device("old-tv-secret", "tv").homeId, db.access("1").homeId);
  const fresh = db.create("3", "Новый"); assert.deepEqual(db.state(fresh.id).read().oauth, {});
  assert.throws(() => db.device("old-phone-hash", "phone"));
});
