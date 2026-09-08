import { createHash, timingSafeEqual } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { join } from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import { handleTelegramCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { GoogleCalendarService } from "./google.js";
import { homeTokenAllowed, issueHomeToken, rememberHomeToken } from "./home-auth.js";
import { BackgroundStore, MediaError } from "./media.js";
import { PairingDesk } from "./pairing.js";
import { EncryptedStore } from "./store.js";
import { parseTelegramUpdate, telegramWebhookReply, verifiedTelegramWebAppUserId } from "./telegram.js";
import { displayModes, displayMoods, displayThemes, liveNote, normalizeRotation, noteDurationsMin, noteExpiresAt, parseNoteMinutes, people, type DisplayMood, type DisplayTheme, type SnapshotEvent, type WeatherSnapshot } from "./types.js";
import { MusicDesk, musicActions } from "./music.js";
import { TvDesk, tvApps, tvKeys } from "./tv-command.js";
import { parseTvVisible, TvPresence } from "./tv-presence.js";
import { fallbackWeather, saintPetersburgWeather } from "./weather.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig();
const dataDir = join(process.cwd(), "data");
const store = new EncryptedStore(join(dataDir, "state.enc"), config.TOKEN_ENCRYPTION_KEY);
const backgrounds = new BackgroundStore(join(dataDir, "backgrounds"));
const calendars = new GoogleCalendarService(config, store);
const pairing = new PairingDesk({
  load: () => store.read().pairings ?? [],
  save: (pairings) => {
    store.update((state) => {
      state.pairings = pairings;
    });
  },
});
const music = new MusicDesk(config.YANDEX_MUSIC_TOKEN);
const tvDesk = new TvDesk();
const tvPresence = new TvPresence();
const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 4_000_000 });
const feedTtlMs = 45_000;
let cachedWeather: WeatherSnapshot = fallbackWeather();
let cachedEvents: SnapshotEvent[] = [];
let feedUpdatedAt = 0;
let feedRefresh: Promise<void> | null = null;

async function refreshLivingRoomFeed(): Promise<void> {
  if (feedRefresh) return feedRefresh;
  feedRefresh = (async () => {
    const [weatherResult, eventsResult] = await Promise.allSettled([
      saintPetersburgWeather(),
      calendars.eventsForNextMonth(),
    ]);
    if (weatherResult.status === "rejected") app.log.warn({ err: weatherResult.reason }, "weather fetch failed");
    else cachedWeather = weatherResult.value;
    if (eventsResult.status === "rejected") app.log.warn({ err: eventsResult.reason }, "calendar fetch failed");
    else cachedEvents = eventsResult.value;
    feedUpdatedAt = Date.now();
  })().finally(() => { feedRefresh = null; });
  return feedRefresh;
}

async function livingRoomFeed(): Promise<void> {
  if (!feedUpdatedAt) await refreshLivingRoomFeed();
  else if (Date.now() - feedUpdatedAt > feedTtlMs) void refreshLivingRoomFeed();
}

app.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (origin !== config.MINI_APP_ORIGIN) return;
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Headers", "content-type, authorization, x-telegram-init-data, x-dino-visible, x-dino-home-token");
  reply.header("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
  reply.header("Vary", "Origin");
  if (request.method === "OPTIONS") return reply.code(204).send();
});

app.get("/health", async () => ({ ok: true, service: "dino-tv-backend", time: new Date().toISOString() }));

app.get("/", async (_, reply) => reply.type("text/html").send(publicPage("Dino TV", `
  <p class="eyebrow">Private household display</p>
  <h1>Ваш дом —<br>в одном красивом экране.</h1>
  <p class="lead">Dino TV показывает время, погоду Санкт-Петербурга, общий ритм двух календарей и настроение гостиной.</p>
  <p class="note">Это частное приложение для одного дома, не публичный сервис.</p>
`)));

app.get("/privacy", async (_, reply) => reply.type("text/html").send(publicPage("Политика конфиденциальности", `
  <p class="eyebrow">Dino TV · privacy</p>
  <h1>Политика<br>конфиденциальности</h1>
  <p class="lead">Обновлено 7 сентября 2026 года.</p>
  <h2>Какие данные использует Dino TV</h2>
  <p>Приложение получает только события Google Calendar, к которым каждый владелец аккаунта дал явное разрешение: название, время и календарь события. Для экрана также запрашивается публичный прогноз погоды Санкт-Петербурга. Фон экрана загружает только человек из дома.</p>
  <h2>Зачем</h2>
  <p>Данные используются исключительно для показа домашнего расписания на телевизоре и выполнения команд авторизованных участников через Telegram.</p>
  <h2>Хранение и защита</h2>
  <p>Токены доступа Google хранятся на личном сервере владельца в зашифрованном виде. Доступ к Telegram-управлению ограничен заранее заданными пользовательскими ID. Мы не продаём данные, не используем рекламу и не передаём календарные данные третьим лицам.</p>
  <h2>Удаление доступа</h2>
  <p>Разрешение можно отозвать в настройках Google Account в любой момент. После этого Dino TV больше не сможет читать календарь этого аккаунта.</p>
`)));

app.get("/terms", async (_, reply) => reply.type("text/html").send(publicPage("Условия использования", `
  <p class="eyebrow">Dino TV · terms</p>
  <h1>Условия<br>использования</h1>
  <p class="lead">Обновлено 7 сентября 2026 года.</p>
  <h2>Назначение</h2>
  <p>Dino TV — приватное домашнее приложение для отображения времени, погоды, событий календаря и выбранного фона на экране в гостиной.</p>
  <h2>Учётные записи</h2>
  <p>Каждый пользователь сам подключает свой Google Calendar и может в любой момент отозвать доступ. Владелец домашнего сервера отвечает за сохранность доступа к нему, настройку Telegram-бота и список людей, которым разрешено управление.</p>
  <h2>Ограничения</h2>
  <p>Сведения на экране предоставляются для удобства и могут обновляться с задержкой. Dino TV не является календарным, погодным или музыкальным сервисом и не гарантирует доступность данных сторонних платформ.</p>
`)));

app.get("/oauth/google/start", async (request, reply) => {
  if (!calendars.isConfigured()) return reply.code(503).send("Google Calendar OAuth is not configured yet");
  const query = z.object({ person: z.enum(people), key: z.string().min(32) }).parse(request.query);
  if (query.key !== config.OAUTH_CONNECT_TOKEN) return reply.code(401).send("Unauthorized");
  return reply.redirect(calendars.authorizationUrl(query.person));
});

app.get("/oauth/google/callback", async (request, reply) => {
  const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
  const person = await calendars.completeAuthorization(query.code, query.state);
  return reply.type("text/html").send(`<!doctype html><title>Dino TV</title><h1>Готово</h1><p>Календарь «${person === "misha" ? "Миша" : "Наташа"}» подключён. Можно закрыть эту страницу.</p>`);
});

app.get("/v1/display/snapshot", async (request, reply) => {
  requireDisplayAccess(request.headers.authorization);
  tvPresence.touch(parseTvVisible(firstHeader(request.headers["x-dino-visible"])));
  await livingRoomFeed();
  const state = store.read();
  const note = liveNote(state.display.note);
  return reply.header("Cache-Control", "no-store").send({
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Moscow",
    weather: cachedWeather,
    days: groupByDay(cachedEvents),
    display: {
      ...state.display,
      note,
      backgroundUrl: state.display.background ? `${config.PUBLIC_BASE_URL}/v1/media/background/${state.display.background.id}` : undefined,
    },
    reloadAt: state.tvReloadAt,
    power: state.tvPower === "off" ? "off" : "on",
    powerAt: state.tvPowerAt,
    nowPlaying: music.snapshot().nowPlaying ?? null,
    music: { connected: music.snapshot().connected },
    musicCommand: music.snapshot().command ?? null,
    tvCommand: tvDesk.snapshot().command ?? null,
    connectedCalendars: Object.fromEntries(people.map((person) => [person, Boolean(state.oauth[person])])),
    tvUrl: `${config.MINI_APP_ORIGIN}/tv/#${store.tvSession()}`,
    inviteCode: pairing.waitingCode(),
  });
});

app.post("/v1/display/pair/start", async () => {
  const started = pairing.start();
  return { pairId: started.pairId, code: started.code, expiresIn: 600 };
});

app.get("/v1/display/pair/wait", async (request) => {
  const query = z.object({ pairId: z.string().min(8) }).parse(request.query);
  return pairing.status(query.pairId);
});

app.get("/v1/media/background/:id", async (request, reply) => {
  const params = z.object({ id: z.string().min(8) }).parse(request.params);
  const file = backgrounds.read(params.id);
  if (!file) return reply.code(404).send({ error: "Not found" });
  return reply
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .type(file.mime)
    .send(file.buffer);
});

app.post("/v1/display/now-playing", async (request) => {
  requireDisplayAccess(request.headers.authorization);
  music.hearFromTv(request.body);
  return { ok: true, nowPlaying: music.snapshot().nowPlaying ?? null };
});

app.get("/v1/miniapp/state", async (request) => {
  requireMiniAppUser(request);
  const state = store.read();
  return {
    display: {
      ...state.display,
      note: liveNote(state.display.note),
      backgroundUrl: state.display.background ? `${config.PUBLIC_BASE_URL}/v1/media/background/${state.display.background.id}` : undefined,
    },
    connectedCalendars: Object.fromEntries(people.map((person) => [person, Boolean(state.oauth[person])])),
    weatherCity: "Санкт-Петербург",
    tvLinked: Boolean(state.tvLinked),
    ...tvView(state),
    tvUrl: `${config.MINI_APP_ORIGIN}/tv/#${store.tvSession()}`,
    nowPlaying: music.snapshot().nowPlaying ?? null,
    music: { connected: music.snapshot().connected },
  };
});

app.patch("/v1/miniapp/display", async (request) => {
  requireMiniAppUser(request);
  const body = z.object({
    mode: z.enum(displayModes).optional(),
    theme: z.enum(displayThemes).optional(),
    mood: z.enum(displayMoods).optional(),
    privacy: z.boolean().optional(),
    showWeather: z.boolean().optional(),
    showCalendar: z.boolean().optional(),
    note: z.string().trim().min(1).max(180).optional(),
    noteMinutes: z.number().int().refine((value) => (noteDurationsMin as readonly number[]).includes(value)).optional(),
    clearNote: z.boolean().optional(),
    clearBackground: z.boolean().optional(),
    reloadTv: z.boolean().optional(),
    tvPower: z.enum(["on", "off"]).optional(),
    rotation: z.object({
      enabled: z.boolean().optional(),
      seconds: z.number().optional(),
      interval: z.number().optional(),
      now: z.number().optional(),
      today: z.number().optional(),
      tomorrow: z.number().optional(),
      week: z.number().optional(),
    }).optional(),
  }).parse(request.body);
  if (body.clearNote && body.note) throw Object.assign(new Error("Choose note or clearNote"), { statusCode: 400 });
  const updated = store.update((state) => {
    if (body.mode) state.display.mode = body.mode;
    if (body.theme === "night" || body.theme === "play") {
      state.display.mood = body.theme;
    } else if (body.theme) {
      state.display.theme = body.theme as DisplayTheme;
      state.display.mood = "home";
    }
    if (body.mood) state.display.mood = body.mood as DisplayMood;
    if (body.privacy !== undefined) state.display.privacy = body.privacy;
    if (body.showWeather !== undefined) state.display.showWeather = body.showWeather;
    if (body.showCalendar !== undefined) state.display.showCalendar = body.showCalendar;
    if (body.note) {
      state.display.note = { text: body.note, expiresAt: noteExpiresAt(parseNoteMinutes(body.noteMinutes)) };
    }
    if (body.clearNote) state.display.note = undefined;
    if (body.clearBackground) {
      backgrounds.remove(state.display.background?.id);
      state.display.background = undefined;
    }
    if (body.reloadTv) state.tvReloadAt = new Date().toISOString();
    if (body.tvPower) {
      state.tvPower = body.tvPower;
      state.tvPowerAt = new Date().toISOString();
    }
    if (body.rotation) {
      state.display.rotation = normalizeRotation({ ...state.display.rotation, ...body.rotation });
    }
  });
  return {
    display: {
      ...updated.display,
      note: liveNote(updated.display.note),
      backgroundUrl: updated.display.background ? `${config.PUBLIC_BASE_URL}/v1/media/background/${updated.display.background.id}` : undefined,
    },
    ...tvView(updated),
    nowPlaying: music.snapshot().nowPlaying ?? null,
    music: { connected: music.snapshot().connected },
  };
});

app.post("/v1/miniapp/music", async (request) => {
  requireMiniAppUser(request);
  const body = z.object({
    action: z.enum(musicActions),
    volume: z.number().min(0).max(100).optional(),
  }).parse(request.body);
  if (body.action === "toTv") {
    const updated = store.update((state) => {
      state.tvPower = "on";
      state.tvPowerAt = new Date().toISOString();
    });
    return {
      nowPlaying: music.snapshot().nowPlaying ?? null,
      music: { connected: music.snapshot().connected },
      ...tvView(updated),
    };
  }
  const result = await music.command(body.action, body.volume);
  return {
    nowPlaying: result.nowPlaying ?? null,
    music: { connected: result.connected },
    ...tvView(),
  };
});

app.post("/v1/miniapp/tv", async (request) => {
  requireMiniAppUser(request);
  const body = z.union([
    z.object({ action: z.literal("launch"), app: z.enum(tvApps) }),
    z.object({ action: z.literal("key"), key: z.enum(tvKeys) }),
  ]).parse(request.body);
  const command = body.action === "launch" ? tvDesk.launch(body.app) : tvDesk.key(body.key);
  let powerState = store.read();
  if (body.action === "launch" && body.app === "kinopoisk") {
    powerState = store.update((state) => {
      state.tvPower = "off";
      state.tvPowerAt = new Date().toISOString();
    });
  }
  if (body.action === "launch" && body.app === "dino") {
    powerState = store.update((state) => {
      state.tvPower = "on";
      state.tvPowerAt = new Date().toISOString();
    });
  }
  return {
    ok: true,
    tvCommand: command,
    ...tvView(powerState),
  };
});

app.post("/v1/miniapp/background", async (request) => {
  requireMiniAppUser(request);
  const body = z.object({ image: z.string().min(32) }).parse(request.body);
  const saved = backgrounds.save(body.image);
  const updated = store.update((state) => {
    backgrounds.remove(state.display.background?.id);
    state.display.background = saved;
  });
  return {
    display: {
      ...updated.display,
      backgroundUrl: `${config.PUBLIC_BASE_URL}/v1/media/background/${saved.id}`,
    },
  };
});

app.post("/v1/miniapp/pair/invite", async (request) => {
  requireMiniAppUser(request);
  const started = pairing.start();
  return { code: started.code, expiresIn: 600 };
});

app.post("/v1/miniapp/pair/approve", async (request) => {
  const body = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
  if (!pairing.approve(body.code, store.tvSession())) {
    throw Object.assign(new Error("Не нашёл такой код. Возьмите свежий на телевизоре или на другом телефоне."), { statusCode: 404 });
  }
  const issued = issueHomeToken();
  store.update((state) => {
    state.tvLinked = true;
    state.homeTokens = rememberHomeToken(state.homeTokens, issued.hash);
  });
  return { ok: true, homeToken: issued.token };
});

app.post("/v1/telegram/webhook", async (request, reply) => {
  const secret = request.headers["x-telegram-bot-api-secret-token"];
  if (secret !== config.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ ok: false });
  const body = parseTelegramUpdate(request.body);
  if (!body) {
    app.log.warn("Ignored malformed Telegram update");
    return reply.send({ ok: true });
  }
  const message = body.message;
  if (!message?.text || !message.from || !config.allowedTelegramUsers.has(String(message.from.id))) {
    return reply.send({ ok: true });
  }
  try {
    const connected = store.read().oauth;
    const response = handleTelegramCommand(message.text, (mutator) => store.update(mutator), {
      misha: Boolean(connected.misha),
      natasha: Boolean(connected.natasha),
    });
    return reply.send(telegramWebhookReply(message.chat.id, response, config.TELEGRAM_WEB_APP_URL));
  } catch (error) {
    app.log.warn({ err: error }, "Telegram command failed");
    return reply.send({ ok: true });
  }
});

function requireDisplayAccess(header: string | undefined): void {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const candidates = [config.DEVICE_TOKEN, store.tvSession()].filter(Boolean);
  const received = createHash("sha256").update(token).digest();
  const allowed = candidates.some((candidate) => {
    const expected = createHash("sha256").update(candidate).digest();
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!allowed) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
}

function tvView(state = store.read()) {
  return {
    tvOnline: tvPresence.online() && state.tvPower !== "off",
    tvPower: state.tvPower === "off" ? "off" as const : "on" as const,
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function miniAppUserAllowed(request: { headers: Record<string, string | string[] | undefined> }): boolean {
  const initData = firstHeader(request.headers["x-telegram-init-data"]);
  const homeToken = firstHeader(request.headers["x-dino-home-token"]);
  if (config.TELEGRAM_BOT_TOKEN) {
    const userId = verifiedTelegramWebAppUserId(initData, config.TELEGRAM_BOT_TOKEN);
    if (userId && config.allowedTelegramUsers.has(String(userId))) return true;
  }
  return homeTokenAllowed(homeToken, store.read().homeTokens ?? []);
}

function requireMiniAppUser(request: { headers: Record<string, string | string[] | undefined> }): void {
  if (miniAppUserAllowed(request)) return;
  const initData = firstHeader(request.headers["x-telegram-init-data"]);
  const homeToken = firstHeader(request.headers["x-dino-home-token"]);
  if (!initData && !homeToken) throw Object.assign(new Error("Введите код с телевизора во вкладке «Ещё»"), { statusCode: 401 });
  throw Object.assign(new Error("Нет доступа к пульту"), { statusCode: 401 });
}

function groupByDay(events: Awaited<ReturnType<typeof calendars.eventsForNextMonth>>) {
  const days = new Map<string, typeof events>();
  for (const event of events) {
    const date = event.start.slice(0, 10);
    days.set(date, [...(days.get(date) ?? []), event]);
  }
  return [...days.entries()].map(([date, dayEvents]) => ({ date, events: dayEvents }));
}

function publicPage(title: string, content: string): string {
  return `<!doctype html>
  <html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="${config.MINI_APP_ORIGIN}/assets/dino-icon-512.png">
  <meta name="theme-color" content="#171815"><title>${title} · Dino TV</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; color: #eee9de; background: radial-gradient(circle at 78% 2%, #4b5143 0, transparent 31rem), #171815; }
    main { width: min(46rem, calc(100% - 3rem)); margin: auto; padding: 8rem 0 5rem; } header, footer { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
    .mark { color: #d4ab70; font-size: .82rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; } nav { display: flex; gap: 1rem; }
    a { color: #d4ab70; text-decoration: none; } a:hover { text-decoration: underline; } section { margin-top: 5.5rem; } .eyebrow { color: #b7b7aa; font-size: .78rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { max-width: 13ch; margin: 1.1rem 0 1.4rem; font-family: Georgia, "Times New Roman", serif; font-size: clamp(3.2rem, 10vw, 6rem); font-weight: 400; line-height: .94; letter-spacing: -.055em; }
    h2 { margin: 2.9rem 0 .65rem; font-size: 1rem; letter-spacing: .01em; } p { max-width: 42rem; color: #c4c2b8; font-size: 1rem; line-height: 1.7; } .lead { color: #eee9de; font-size: 1.22rem; } .note { margin-top: 2rem; color: #9c9b91; font-size: .9rem; }
    footer { margin-top: 6rem; padding-top: 1.4rem; border-top: 1px solid #3b3d36; color: #8d8d84; font-size: .82rem; }
    @media (max-width: 35rem) { main { padding-top: 3rem; } h1 { font-size: 3.35rem; } }
  </style></head><body><main><header><a class="mark" href="/">Dino TV</a><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></header><section>${content}</section><footer><span>Private household display</span><span>© 2026 Dino TV</span></footer></main></body></html>`;
}

app.setErrorHandler((error, _, reply) => {
  app.log.error(error);
  const statusCode = error instanceof MediaError ? error.statusCode : (error as { statusCode?: number }).statusCode ?? 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  reply.code(statusCode).send({ error: message });
});

app.listen({ port: config.PORT, host: "0.0.0.0" })
  .catch((error) => { app.log.error(error); process.exit(1); });
