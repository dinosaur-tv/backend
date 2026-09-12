import { setDefaultResultOrder } from "node:dns";
import { join } from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import { handleTelegramCommand } from "./commands.js";
import { type Config } from "./config.js";
import { AttemptLimiter, mediaAllowed, requireRemoteEnabled, signMedia } from "./security.js";
import { GoogleCalendarService } from "./google.js";
import { BackgroundStore, MediaError } from "./media.js";
import { type StateStore } from "./store.js";
import { parseTelegramUpdate, telegramWebhookReply } from "./telegram.js";
import {
  displayModes,
  displayMoods,
  displayThemes,
  liveNote,
  normalizePlace,
  normalizeRotation,
  noteDurationsMin,
  noteExpiresAt,
  parseNoteMinutes,
  people,
  type DisplayMood,
  type DisplayTheme,
  type SnapshotEvent,
} from "./types.js";
import { MusicDesk, musicActions } from "./music.js";
import { TvDesk, tvApps, tvKeys } from "./tv-command.js";
import { parseTvVisible, TvPresence } from "./tv-presence.js";

setDefaultResultOrder("ipv4first");

/** Изолированный маршрутизатор одного дома. Никогда не слушает сетевой порт. */
export function createHomeApp(config: Config, store: StateStore, dataDir: string, homeId: string, internalToken: string) {
  const backgrounds = new BackgroundStore(join(dataDir, "backgrounds", homeId));
  const calendars = new GoogleCalendarService(config, store, homeId);
  const music = new MusicDesk();
  const tvDesk = new TvDesk();
  const tvPresence = new TvPresence();
  const app = Fastify({
    logger: false,
    trustProxy: config.TRUST_PROXY ? config.TRUST_PROXY.split(",").map((item) => item.trim()) : false,
    bodyLimit: 4_000_000,
  });
  const attempts = new AttemptLimiter();
  const features = { tvRemote: config.TV_REMOTE_ENABLED };
  const personLabels = { misha: config.PERSON_1_NAME, natasha: config.PERSON_2_NAME };
  function backgroundUrl(id: string): string {
    const expires = (Math.floor(Date.now() / 300_000) + 3) * 300_000;
    return `${config.PUBLIC_BASE_URL}/v1/media/background/${homeId}/${id}?expires=${expires}&signature=${signMedia(homeId + "/" + id, expires, config.TOKEN_ENCRYPTION_KEY)}`;
  }
  const feedTtlMs = 45_000;
  let cachedEvents: SnapshotEvent[] = [];
  let feedUpdatedAt = 0;
  let feedRevision = 0;
  let feedRefresh: Promise<void> | null = null;

  async function refreshLivingRoomFeed(): Promise<void> {
    if (feedRefresh) return feedRefresh;
    const revision = feedRevision;
    feedRefresh = (async () => {
      const [eventsResult] = await Promise.allSettled([calendars.eventsForNextMonth()]);
      if (revision !== feedRevision) return;
      if (eventsResult.status === "rejected") app.log.warn("calendar fetch failed");
      else cachedEvents = eventsResult.value;
      feedUpdatedAt = Date.now();
    })().finally(() => {
      feedRefresh = null;
    });
    return feedRefresh;
  }

  async function livingRoomFeed(): Promise<void> {
    if (!feedUpdatedAt) await refreshLivingRoomFeed();
    else if (Date.now() - feedUpdatedAt > feedTtlMs) void refreshLivingRoomFeed();
  }

  app.addHook("onRequest", async (request, reply) => {
    if (request.headers["x-dino-internal"] !== internalToken) return reply.code(401).send({ error: "Unauthorized" });
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff");
    const path = request.url.split("?")[0];
    if (path.includes("/pair/")) {
      const approve = path.endsWith("/approve");
      const start = path.endsWith("/start");
      const limit = approve ? 5 : start ? 30 : 120;
      const windowMs = approve ? 600_000 : 60_000;
      if (!attempts.allow(`${path}:${request.ip}`, limit, windowMs) || (approve && !attempts.allow("pair-approve-global", 30, 600_000))) {
        return reply
          .code(429)
          .header("Retry-After", String(windowMs / 1000))
          .send({ error: "Слишком много попыток. Подождите перед повтором." });
      }
    }
    const origin = request.headers.origin;
    if (origin !== config.MINI_APP_ORIGIN) return;
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Headers", "content-type, authorization, x-telegram-init-data, x-dino-visible, x-dino-home-token");
    reply.header("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
    reply.header("Vary", "Origin");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });

  app.get("/health", async () => ({ ok: true, service: "dino-tv-backend", time: new Date().toISOString() }));

  app.get("/", async (_, reply) =>
    reply.type("text/html").send(
      publicPage(
        "Dino TV",
        `
  <p class="eyebrow">Private household display</p>
  <h1>Ваш дом —<br>в одном красивом экране.</h1>
  <p class="lead">Dino TV показывает время, погоду Санкт-Петербурга, общий ритм двух календарей и настроение гостиной.</p>
  <p class="note">Это частное приложение для одного дома, не публичный сервис.</p>
`,
      ),
    ),
  );

  app.get("/privacy", async (_, reply) =>
    reply.type("text/html").send(
      publicPage(
        "Политика конфиденциальности",
        `
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
`,
      ),
    ),
  );

  app.get("/terms", async (_, reply) =>
    reply.type("text/html").send(
      publicPage(
        "Условия использования",
        `
  <p class="eyebrow">Dino TV · terms</p>
  <h1>Условия<br>использования</h1>
  <p class="lead">Обновлено 7 сентября 2026 года.</p>
  <h2>Назначение</h2>
  <p>Dino TV — приватное домашнее приложение для отображения времени, погоды, событий календаря и выбранного фона на экране в гостиной.</p>
  <h2>Учётные записи</h2>
  <p>Каждый пользователь сам подключает свой Google Calendar и может в любой момент отозвать доступ. Владелец домашнего сервера отвечает за сохранность доступа к нему, настройку Telegram-бота и список людей, которым разрешено управление.</p>
  <h2>Ограничения</h2>
  <p>Сведения на экране предоставляются для удобства и могут обновляться с задержкой. Dino TV не является календарным, погодным или музыкальным сервисом и не гарантирует доступность данных сторонних платформ.</p>
`,
      ),
    ),
  );

  app.get("/oauth/google/start", async (_, reply) => {
    return reply
      .code(410)
      .send({ error: "Подключите календарь через Ещё → Календари в авторизованной консоли. Секреты в URL больше не используются." });
  });

  app.post("/v1/miniapp/calendars/connect", async (request) => {
    requireMiniAppUser(request);
    const { person } = z.object({ person: z.enum(people) }).parse(request.body);
    if (!calendars.isConfigured()) throw Object.assign(new Error("Владелец сервера ещё не настроил Google OAuth"), { statusCode: 503 });
    return { url: calendars.authorizationUrl(person, firstHeader(request.headers["x-dino-actor"])) };
  });

  app.get("/v1/miniapp/calendars/:person", async (request) => {
    requireMiniAppUser(request);
    const { person } = z.object({ person: z.enum(people) }).parse(request.params);
    return { calendars: await calendars.listCalendars(person) };
  });

  app.patch("/v1/miniapp/calendars/:person", async (request) => {
    requireMiniAppUser(request);
    const { person } = z.object({ person: z.enum(people) }).parse(request.params);
    const { calendarIds } = z.object({ calendarIds: z.array(z.string().min(1).max(512)).min(1).max(20) }).parse(request.body);
    await calendars.selectCalendars(person, calendarIds);
    cachedEvents = [];
    feedUpdatedAt = 0;
    feedRevision++;
    return { ok: true };
  });

  app.post("/v1/miniapp/calendars/disconnect", async (request) => {
    requireMiniAppUser(request);
    const { person } = z.object({ person: z.enum(people) }).parse(request.body);
    calendars.disconnect(person);
    cachedEvents = [];
    feedUpdatedAt = 0;
    feedRevision++;
    return { ok: true };
  });

  app.get("/oauth/google/callback", async (request, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    const person = await calendars.completeAuthorization(query.code, query.state);
    cachedEvents = [];
    feedUpdatedAt = 0;
    feedRevision++;
    return reply
      .type("text/html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Dino TV</title><h1>Готово</h1><p>Календарь ${people.indexOf(person) + 1} подключён. Вернитесь в приложение, чтобы выбрать календари.</p>`,
      );
  });

  app.get("/v1/display/snapshot", async (request, reply) => {
    requireDisplayAccess(request.headers.authorization);
    tvPresence.touch(parseTvVisible(firstHeader(request.headers["x-dino-visible"])));
    await livingRoomFeed();
    const state = store.read();
    const note = liveNote(state.display.note);
    return reply.header("Cache-Control", "no-store").send({
      generatedAt: new Date().toISOString(),
      timezone: state.display.place.timezone,
      days: groupByDay(cachedEvents),
      display: {
        ...state.display,
        note,
        backgroundUrl: state.display.background ? backgroundUrl(state.display.background.id) : undefined,
      },
      reloadAt: state.tvReloadAt,
      power: state.tvPower === "off" ? "off" : "on",
      powerAt: state.tvPowerAt,
      nowPlaying: music.snapshot().nowPlaying ?? null,
      music: { connected: music.snapshot().connected },
      musicCommand: music.snapshot().command ?? null,
      features,
      personLabels,
      tvCommand: config.TV_REMOTE_ENABLED ? (tvDesk.snapshot().command ?? null) : null,
      tvCommands: config.TV_REMOTE_ENABLED ? tvDesk.snapshot().commands : [],
      connectedCalendars: Object.fromEntries(people.map((person) => [person, Boolean(state.oauth[person])])),
      inviteCode: null,
    });
  });

  app.get("/v1/media/background/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(8) }).parse(request.params);
    const query = z.object({ expires: z.coerce.number(), signature: z.string() }).parse(request.query);
    if (!mediaAllowed(homeId + "/" + params.id, query.expires, query.signature, config.TOKEN_ENCRYPTION_KEY))
      return reply.code(401).send({ error: "Unauthorized" });
    const file = backgrounds.read(params.id);
    if (!file) return reply.code(404).send({ error: "Not found" });
    return reply.header("Cache-Control", "private, no-store").type(file.mime).send(file.buffer);
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
      features,
      personLabels,
      googleConfigured: calendars.isConfigured(),
      display: {
        ...state.display,
        note: liveNote(state.display.note),
        backgroundUrl: state.display.background ? backgroundUrl(state.display.background.id) : undefined,
      },
      connectedCalendars: Object.fromEntries(people.map((person) => [person, Boolean(state.oauth[person])])),
      tvLinked: Boolean(state.tvLinked),
      ...tvView(state),
      nowPlaying: music.snapshot().nowPlaying ?? null,
      music: { connected: music.snapshot().connected },
    };
  });

  app.patch("/v1/miniapp/display", async (request) => {
    requireMiniAppUser(request);
    const body = z
      .object({
        mode: z.enum(displayModes).optional(),
        theme: z.enum(displayThemes).optional(),
        mood: z.enum(displayMoods).optional(),
        privacy: z.boolean().optional(),
        showWeather: z.boolean().optional(),
        showCalendar: z.boolean().optional(),
        note: z.string().trim().min(1).max(180).optional(),
        noteMinutes: z
          .number()
          .int()
          .refine((value) => (noteDurationsMin as readonly number[]).includes(value))
          .optional(),
        clearNote: z.boolean().optional(),
        clearBackground: z.boolean().optional(),
        place: z.object({
          name: z.string().trim().min(1).max(60),
          latitude: z.number(),
          longitude: z.number(),
          timezone: z.string().trim().min(1).max(64),
        }).optional(),
        reloadTv: z.boolean().optional(),
        tvPower: z.enum(["on", "off"]).optional(),
        rotation: z
          .object({
            enabled: z.boolean().optional(),
            seconds: z.number().optional(),
            interval: z.number().optional(),
            now: z.number().optional(),
            today: z.number().optional(),
            tomorrow: z.number().optional(),
            week: z.number().optional(),
          })
          .optional(),
      })
      .parse(request.body);
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
      if (body.place) {
        const place = normalizePlace(body.place);
        if (!place) throw Object.assign(new Error("Не удалось распознать место"), { statusCode: 400 });
        state.display.place = place;
      }
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
        backgroundUrl: updated.display.background ? backgroundUrl(updated.display.background.id) : undefined,
      },
      ...tvView(updated),
      nowPlaying: music.snapshot().nowPlaying ?? null,
      music: { connected: music.snapshot().connected },
    };
  });

  app.post("/v1/miniapp/music", async (request) => {
    requireMiniAppUser(request);
    const body = z
      .object({
        action: z.enum(musicActions),
        volume: z.number().min(0).max(100).optional(),
      })
      .parse(request.body);
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
    requireRemoteEnabled(config.TV_REMOTE_ENABLED);
    const body = z
      .union([z.object({ action: z.literal("launch"), app: z.enum(tvApps) }), z.object({ action: z.literal("key"), key: z.enum(tvKeys) })])
      .parse(request.body);
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
        backgroundUrl: backgroundUrl(saved.id),
      },
    };
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
    if (
      !message?.text ||
      !message.from ||
      message.chat.id !== message.from.id ||
      request.headers["x-dino-internal"] !== internalToken
    ) {
      return reply.send({ ok: true });
    }
    try {
      const connected = store.read().oauth;
      const response = handleTelegramCommand(
        message.text,
        (mutator) => store.update(mutator),
        {
          misha: Boolean(connected.misha),
          natasha: Boolean(connected.natasha),
        },
        personLabels,
      );
      return reply.send(telegramWebhookReply(message.chat.id, response, config.TELEGRAM_WEB_APP_URL));
    } catch (error) {
      app.log.warn({ err: error }, "Telegram command failed");
      return reply.send({ ok: true });
    }
  });

  function requireDisplayAccess(_header: string | undefined): void {
    // Авторизация выполнена шлюзом и обязательным onRequest выше.
  }

  function tvView(state = store.read()) {
    return {
      tvOnline: tvPresence.online() && state.tvPower !== "off",
      tvPower: state.tvPower === "off" ? ("off" as const) : ("on" as const),
    };
  }

  function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  function requireMiniAppUser(request: { headers: Record<string, string | string[] | undefined> }): void {
    if (request.headers["x-dino-internal"] !== internalToken) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
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
    // OAuth/Gaxios errors may contain codes, secrets and response bodies: never log them.
    const statusCode =
      error instanceof z.ZodError
        ? 400
        : error instanceof MediaError
          ? error.statusCode
          : ((error as { statusCode?: number }).statusCode ?? 500);
    app.log.warn({ statusCode, errorType: error instanceof Error ? error.name : "Unknown" }, "request failed");
    const message =
      statusCode >= 500
        ? "Сервис временно недоступен"
        : error instanceof z.ZodError
          ? "Invalid request"
          : error instanceof Error
            ? error.message
            : "Request failed";
    reply.code(statusCode).send({ error: message });
  });

  return app;
}
