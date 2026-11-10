import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  API_DOMAIN: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  DEVICE_TOKEN: z.union([z.literal(""), z.string().min(32)]).default(""),
  // The dashboard can start before Calendar OAuth is configured.
  GOOGLE_CLIENT_ID: z.string().optional().transform((value) => value?.trim() || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((value) => value?.trim() || undefined),
  // Where to send Google callbacks that are not ours, when another local service shares this redirect URI.
  OAUTH_FORWARD_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(""),
  REGISTRATION_OPEN: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MAX_HOUSEHOLDS: z.coerce.number().int().min(1).max(1000).default(100),
  MINI_APP_ORIGIN: z.string().url(),
  TELEGRAM_WEB_APP_URL: z.string().url(),
  TV_REMOTE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  TRUST_PROXY: z.string().default(""),
  PERSON_1_NAME: z.string().trim().min(1).max(60).default("Участник 1"),
  PERSON_2_NAME: z.string().trim().min(1).max(60).default("Участник 2"),
});

export type Config = z.infer<typeof configSchema> & {
  allowedTelegramUsers: Set<string>;
};

const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = configSchema.parse(env);
  return { ...raw, allowedTelegramUsers: new Set(splitList(raw.TELEGRAM_ALLOWED_USER_IDS)) };
}
