import { createHmac, timingSafeEqual } from "node:crypto";

/** Returns a Telegram user id only when the Mini App payload has a valid signature and is fresh. */
export function verifiedTelegramWebAppUserId(
  initData: string | undefined,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): number | undefined {
  if (!initData) return undefined;

  const parameters = new URLSearchParams(initData);
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
    return typeof user.id === "number" && Number.isSafeInteger(user.id) ? user.id : undefined;
  } catch {
    return undefined;
  }
}
