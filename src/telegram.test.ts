import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseTelegramUpdate, telegramWebhookReply, verifiedTelegramWebAppUserId } from "./telegram.js";

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

test("answers /start through the webhook so Telegram can deliver the reply itself", () => {
  const payload = telegramWebhookReply(200109375, { text: "Рад вас видеть.", openMiniApp: true }, "https://home.dym-dino.ru/console/");
  assert.equal(payload.method, "sendMessage");
  assert.equal(payload.chat_id, 200109375);
  assert.equal("inline_keyboard" in payload.reply_markup, true);
  assert.equal("remove_keyboard" in payload.reply_markup, false);
});

test("hides the old reply keyboard without mixing markup types", () => {
  const payload = telegramWebhookReply(200109375, { text: "Готово." }, "https://home.dym-dino.ru/console/");
  assert.deepEqual(payload.reply_markup, { remove_keyboard: true });
});

test("accepts a real Telegram /start update with extra fields", () => {
  const parsed = parseTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 2,
      from: { id: 200109375, is_bot: false, first_name: "Misha", language_code: "ru", is_premium: true },
      chat: { id: 200109375, type: "private" },
      date: now,
      text: "/start",
      entities: [{ offset: 0, length: 6, type: "bot_command" }],
    },
  });
  assert.equal(parsed?.message?.from?.id, 200109375);
  assert.equal(parsed?.message?.text, "/start");
});
