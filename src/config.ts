import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  API_DOMAIN: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  DEVICE_TOKEN: z.string().min(32),
  OAUTH_CONNECT_TOKEN: z.string().min(32),
  // The dashboard can start before Calendar OAuth is configured.
  GOOGLE_CLIENT_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((value) => value?.trim() || undefined),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
  MINI_APP_ORIGIN: z.string().url().default("https://home.dym-dino.ru"),
  TELEGRAM_WEB_APP_URL: z.string().url().default("https://home.dym-dino.ru/console/"),
  YANDEX_MUSIC_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  MISHA_CALENDAR_IDS: z.string().default(""),
  NATASHA_CALENDAR_IDS: z.string().default(""),
});

export type Config = z.infer<typeof configSchema> & {
  allowedTelegramUsers: Set<string>;
  calendarIds: { misha: string[]; natasha: string[] };
};

const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function loadConfig(): Config {
  const raw = configSchema.parse(process.env);
  return {
    ...raw,
    allowedTelegramUsers: new Set(splitList(raw.TELEGRAM_ALLOWED_USER_IDS)),
    calendarIds: {
      misha: splitList(raw.MISHA_CALENDAR_IDS),
      natasha: splitList(raw.NATASHA_CALENDAR_IDS),
    },
  };
}
