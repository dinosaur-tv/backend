import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { TelegramReply } from "./commands.js";

const telegramUpdateSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    from: z.object({ id: z.coerce.number() }).passthrough().optional(),
    chat: z.object({ id: z.coerce.number() }).passthrough(),
  }).passthrough().optional(),
}).passthrough();

export type TelegramUpdateMessage = {
  text?: string;
  from?: { id: number };
  chat: { id: number };
};

/** Telegram rejects mixing ReplyKeyboardRemove with an inline keyboard in one markup object. */
export function telegramReplyMarkup(openMiniApp: boolean | undefined, webAppUrl: string) {
  if (openMiniApp) {
    return { inline_keyboard: [[{ text: "Открыть Dino TV", web_app: { url: webAppUrl } }]] };
  }
  return { remove_keyboard: true as const };
}

/** Answer the webhook with a Bot API method so Telegram delivers the reply even if the VPS cannot reach api.telegram.org. */
export function telegramWebhookReply(chatId: number, reply: TelegramReply, webAppUrl: string) {
  return {
    method: "sendMessage" as const,
    chat_id: chatId,
    text: reply.text,
    reply_markup: telegramReplyMarkup(reply.openMiniApp, webAppUrl),
  };
}

export function parseTelegramUpdate(body: unknown): { message?: TelegramUpdateMessage } | undefined {
  const parsed = telegramUpdateSchema.safeParse(body);
  if (!parsed.success) return undefined;
  return parsed.data;
}

/** Returns a Telegram user id only when the Mini App payload has a valid signature and is fresh. */
export function verifiedTelegramWebAppUserId(
  initData: string | undefined,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): number | undefined {
  if (!initData || initData.length > 16_384) return undefined;

  const parameters = new URLSearchParams(initData);
  if (new Set(parameters.keys()).size !== [...parameters.keys()].length) return undefined;
  const receivedHash = parameters.get("hash");
  const authDate = Number(parameters.get("auth_date"));
  const rawUser = parameters.get("user");
  if (!receivedHash || !rawUser || !Number.isFinite(authDate) || nowSeconds - authDate > 86_400 || authDate > nowSeconds + 60) {
    return undefined;
  }

  const checkString = [...parameters.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(checkString).digest("hex");
  const received = Buffer.from(receivedHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;

  try {
    const user = JSON.parse(rawUser) as { id?: unknown };
    return typeof user.id === "number" && Number.isSafeInteger(user.id) && user.id > 0 ? user.id : undefined;
  } catch {
    return undefined;
  }
}
