import { createHash } from "node:crypto";
import { join } from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { GoogleCalendarService } from "./google.js";
import { EncryptedStore } from "./store.js";
import { people, type DisplayMode, type DisplayTheme, type Person } from "./types.js";
import { saintPetersburgWeather } from "./weather.js";

const config = loadConfig();
const store = new EncryptedStore(join(process.cwd(), "data", "state.enc"), config.TOKEN_ENCRYPTION_KEY);
const calendars = new GoogleCalendarService(config, store);
const app = Fastify({ logger: true, trustProxy: true });

const displayModes = ["NOW", "TODAY", "WEEK", "MONTH"] as const;
const displayThemes = ["forest", "stone", "tobacco", "taupe", "apple"] as const;

app.get("/health", async () => ({ ok: true, service: "dino-tv-backend", time: new Date().toISOString() }));

app.get("/", async (_, reply) => reply.type("text/html").send(publicPage("Dino TV", `
  <p class="eyebrow">Private household display</p>
  <h1>Ваш дом —<br>в одном красивом экране.</h1>
  <p class="lead">Dino TV показывает время, погоду Санкт-Петербурга, общий ритм двух календарей и текущую музыку на телевизоре.</p>
  <p class="note">Это частное приложение для одного дома, не публичный сервис.</p>
`)));

app.get("/privacy", async (_, reply) => reply.type("text/html").send(publicPage("Политика конфиденциальности", `
  <p class="eyebrow">Dino TV · privacy</p>
  <h1>Политика<br>конфиденциальности</h1>
  <p class="lead">Обновлено 7 сентября 2026 года.</p>
  <h2>Какие данные использует Dino TV</h2>
  <p>Приложение получает только события Google Calendar, к которым каждый владелец аккаунта дал явное разрешение: название, время и календарь события. Для экрана также запрашивается публичный прогноз погоды Санкт-Петербурга.</p>
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
  <p>Dino TV — приватное домашнее приложение для отображения времени, погоды, событий календаря и информации о воспроизведении музыки на Android TV.</p>
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
  requireDevice(request.headers.authorization);
  const [weather, events] = await Promise.all([saintPetersburgWeather(), calendars.eventsForNextMonth()]);
  const state = store.read();
  const note = state.display.note && new Date(state.display.note.expiresAt) > new Date() ? state.display.note : undefined;
  return reply.send({
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Moscow",
    weather,
    days: groupByDay(events),
    display: { ...state.display, note },
    connectedCalendars: Object.fromEntries(people.map((person) => [person, Boolean(state.oauth[person])])),
  });
});

app.post("/v1/telegram/webhook", async (request, reply) => {
  const secret = request.headers["x-telegram-bot-api-secret-token"];
  if (secret !== config.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ ok: false });
  const body = z.object({
    message: z.object({
      text: z.string().optional(),
      from: z.object({ id: z.number() }).optional(),
      chat: z.object({ id: z.number() }),
    }).optional(),
  }).passthrough().parse(request.body);
  const message = body.message;
  if (!message?.text || !message.from || !config.allowedTelegramUsers.has(String(message.from.id))) {
    return reply.send({ ok: true });
  }
  const response = handleTelegramCommand(message.text);
  await replyToTelegram(message.chat.id, response);
  return reply.send({ ok: true });
});

function requireDevice(header: string | undefined): void {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const received = createHash("sha256").update(token).digest("hex");
  const expected = createHash("sha256").update(config.DEVICE_TOKEN).digest("hex");
  if (received !== expected) {
    const error = new Error("Unauthorized");
    Object.assign(error, { statusCode: 401 });
    throw error;
  }
}

function handleTelegramCommand(text: string): string {
  const [commandWithBot, ...argumentsList] = text.trim().split(/\s+/);
  const command = commandWithBot.toLowerCase().split("@")[0];
  const argument = argumentsList.join(" ");
  const update = (mutator: Parameters<typeof store.update>[0]) => store.update(mutator);
  if (command === "/now" || command === "/today" || command === "/week" || command === "/month") {
    const mode = command.slice(1).toUpperCase() as DisplayMode;
    update((state) => { state.display.mode = mode; });
    return `Экран: ${mode}.`;
  }
  if (command === "/theme") {
    if (!(displayThemes as readonly string[]).includes(argument)) return "Тема: forest, stone, tobacco, taupe или apple.";
    update((state) => { state.display.theme = argument as DisplayTheme; });
    return `Тема: ${argument}.`;
  }
  if (command === "/privacy") {
    if (argument !== "on" && argument !== "off") return "Использование: /privacy on или /privacy off";
    update((state) => { state.display.privacy = argument === "on"; });
    return argument === "on" ? "Гостевой режим включён." : "Гостевой режим выключен.";
  }
  if (command === "/note") {
    if (!argument) return "Использование: /note текст заметки";
    update((state) => { state.display.note = { text: argument.slice(0, 180), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }; });
    return "Заметка показана на один час.";
  }
  if (command === "/status") {
    const connected = store.read().oauth;
    return `Календари: Миша — ${connected.misha ? "подключён" : "не подключён"}; Наташа — ${connected.natasha ? "подключён" : "не подключён"}.`;
  }
  return "Команды: /now, /today, /week, /month, /theme, /privacy, /note, /status";
}

async function replyToTelegram(chatId: number, text: string): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) app.log.warn({ status: response.status }, "Telegram reply failed");
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
  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  reply.code(statusCode).send({ error: message });
});

app.listen({ port: config.PORT, host: "0.0.0.0" })
  .catch((error) => { app.log.error(error); process.exit(1); });
