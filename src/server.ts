import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { z } from "zod";
import { loadConfig, type Config } from "./config.js";
import { createHomeApp } from "./home-app.js";
import { Households, fail, type Access } from "./households.js";
import { AttemptLimiter, mediaAllowed } from "./security.js";
import { parseTelegramUpdate, telegramWebhookReply, verifiedTelegramWebAppUserId } from "./telegram.js";
import { people, type Person } from "./types.js";

const idSchema = z.string().uuid();
const codeSchema = z.object({ code: z.string().regex(/^(?:\d{6}|\d{10})$/) });
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/** Публичный шлюз: аутентификация, членство и назначение дома до доступа к любому сервису. */
export function createApp(config: Config, dataDir = join(process.cwd(), "data")) {
  const homes = new Households(dataDir, config);
  const instances = new Map<string, ReturnType<typeof createHomeApp>>();
  const internalToken = randomBytes(32).toString("base64url");
  const attempts = new AttemptLimiter();
  const app = Fastify({
    logger: { serializers: { req: (req) => ({ method: req.method, url: req.url?.split("?")[0] }) } },
    trustProxy: config.TRUST_PROXY ? config.TRUST_PROXY.split(",").map((v) => v.trim()) : false,
    bodyLimit: 4_000_000,
  });
  function household(id: string) {
    if (!homes.exists(id)) return fail(404, "Дом недоступен");
    let instance = instances.get(id);
    if (!instance) {
      const legacy = homes.isLegacy(id);
      const state = homes.state(id).read();
      instance = createHomeApp({ ...config,
        PERSON_1_NAME: state.personLabels?.misha ?? (legacy ? config.PERSON_1_NAME : "Участник 1"),
        PERSON_2_NAME: state.personLabels?.natasha ?? (legacy ? config.PERSON_2_NAME : "Участник 2"),
      }, homes.state(id), dataDir, id, internalToken);
      instances.set(id, instance);
    }
    return instance;
  }
  function telegram(request: FastifyRequest): string | undefined {
    if (!config.TELEGRAM_BOT_TOKEN) return;
    const id = verifiedTelegramWebAppUserId(first(request.headers["x-telegram-init-data"]), config.TELEGRAM_BOT_TOKEN);
    return id ? String(id) : undefined;
  }
  function requireTelegram(request: FastifyRequest): string {
    return telegram(request) ?? fail(401, "Откройте мини-приложение из Telegram-бота");
  }
  function access(request: FastifyRequest): Access {
    const selected = first(request.headers["x-dino-home-id"]);
    if (selected) idSchema.parse(selected);
    const userId = telegram(request);
    if (userId) return homes.access(userId, selected);
    // Неверная подпись не может незаметно переключить пользователя на другой способ входа.
    if (request.headers["x-telegram-init-data"]) return fail(401, "Откройте мини-приложение заново из бота");
    const auth = homes.device(first(request.headers["x-dino-home-token"]), "phone");
    if (selected && auth.homeId !== selected) fail(403, "Телефон привязан к другому дому");
    return auth;
  }
  function tvAccess(request: FastifyRequest) {
    const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
    const auth = homes.device(token, "tv");
    const selected = first(request.headers["x-dino-home-id"]);
    if (selected && selected !== auth.homeId) fail(403, "Телевизор привязан к другому дому");
    return auth;
  }
  async function forward(homeId: string, request: FastifyRequest, reply: FastifyReply, url = request.url, recheck?: () => unknown) {
    const response = await household(homeId).inject({ method: request.method as "GET" | "POST" | "PATCH", url,
      headers: { "content-type": "application/json", "x-dino-internal": internalToken,
        "x-dino-visible": first(request.headers["x-dino-visible"]) ?? "true",
        ...(url === "/v1/miniapp/calendars/connect" ? { "x-dino-actor": access(request).userId } : {}),
        "x-telegram-bot-api-secret-token": config.TELEGRAM_WEBHOOK_SECRET },
      ...(request.body !== undefined ? { payload: JSON.stringify(request.body) } : {}),
    });
    recheck?.();
    reply.code(response.statusCode).type(String(response.headers["content-type"] ?? "application/json"));
    if (url.split("?")[0] === "/v1/miniapp/state" && response.statusCode === 200) {
      const auth = access(request), data = response.json();
      return reply.send({ ...data, household: homes.list(auth.userId).find((home) => home.id === homeId), permissions: { manageHome: auth.role === "owner", manageCalendars: Object.fromEntries(people.map((person) => [person, homes.calendarAccess(auth, person)])) } });
    }
    return reply.send(response.rawPayload);
  }
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff");
    if (request.headers.origin === config.MINI_APP_ORIGIN) {
      reply.header("Access-Control-Allow-Origin", config.MINI_APP_ORIGIN).header("Vary", "Origin")
        .header("Access-Control-Allow-Headers", "content-type, authorization, x-telegram-init-data, x-dino-visible, x-dino-home-token, x-dino-home-id")
        .header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      if (request.method === "OPTIONS") return reply.code(204).send();
    }
    const path = request.url.split("?")[0];
    if (!attempts.allow("ip:" + request.ip, 360, 60_000)) return reply.code(429).header("Retry-After", "60").send({ error: "Слишком много запросов" });
    if (path.endsWith("/approve") || path.endsWith("/join")) {
      if (!attempts.allow("code:" + request.ip, 5, 600_000) || !attempts.allow("codes-global", 100, 600_000)) return reply.code(429).header("Retry-After", "600").send({ error: "Подождите перед повторным вводом кода" });
    }
    if (path.endsWith("/start") && !attempts.allow("start:" + request.ip, 10, 60_000)) return reply.code(429).send({ error: "Слишком много попыток привязки" });
  });
  app.get("/health", async () => ({ ok: true, service: "dino-tv-backend" }));
  app.get("/", async (_, reply) => reply.type("text/html").send(publicPage("Dino TV", "Ваш домашний экран", "Создайте свой дом в Telegram-боте, подключите календари и привяжите телевизор. У каждого дома отдельные участники, настройки и устройства.")));
  app.get("/privacy", async (_, reply) => reply.type("text/html").send(publicPage("Конфиденциальность", "Ваши данные", "Сервис хранит Telegram ID, членство в домах, настройки, загруженные фоны и зашифрованные токены Google. События календарей и сведения о музыке доступны участникам вашего дома и привязанным устройствам. Календари используются только для домашнего расписания, не для рекламы. Владелец сервера имеет административный доступ к хранилищу. Отключить Google можно в приложении или в аккаунте Google. Владелец дома может удалить дом и его активные данные. Копии резервного хранения удаляет оператор сервера по своей политике. Не подключайте личные календари к серверу, оператору которого вы не доверяете.")));
  app.get("/terms", async (_, reply) => reply.type("text/html").send(publicPage("Условия", "Использование Dino TV", "Владелец дома отвечает за приглашения и привязку устройств: участники видят общее расписание. Сведения могут обновляться с задержкой. Работа Google, Telegram и телевизора зависит от сторонних сервисов. Это домашний экран, а не система критических уведомлений.")));
  app.get("/oauth/google/start", async (_, reply) => reply.code(410).send({ error: "Подключите календарь в приложении: Ещё → Календари" }));
  app.get("/oauth/google/callback", async (request, reply) => {
    const query = z.object({ state: z.string().max(200), code: z.string().min(1).max(4096) }).parse(request.query);
    // Ours always reads "<ID дома>.<токен>". Другой сервис может делить этот redirect URI.
    const [prefix, token] = query.state.split(".");
    if (!token || !idSchema.safeParse(prefix).success) {
      if (!config.OAUTH_FORWARD_URL) return fail(400, "Этот ответ Google не относится к Dino TV");
      const target = new URL(config.OAUTH_FORWARD_URL);
      target.searchParams.set("code", query.code);
      target.searchParams.set("state", query.state);
      return reply.redirect(target.toString());
    }
    return forward(prefix, request, reply);
  });
  app.get("/v1/miniapp/households", async (request) => {
    const userId = telegram(request);
    if (userId) { const list = homes.list(userId); return { households: list, activeHomeId: list.length ? homes.access(userId).homeId : null, registrationOpen: config.REGISTRATION_OPEN, telegram: true }; }
    const auth = access(request);
    return { households: homes.list(auth.userId).filter((h) => h.id === auth.homeId), registrationOpen: false, telegram: false };
  });
  app.post("/v1/miniapp/households", async (request) => {
    const userId = requireTelegram(request);
    if (!attempts.allow("new-home:" + userId, 5, 3600_000)) fail(429, "Слишком много новых домов за час");
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(request.body);
    return { household: homes.create(userId, name) };
  });
  app.post("/v1/miniapp/households/select", async (request) => {
    const { id } = z.object({ id: idSchema }).parse(request.body);
    return homes.select(requireTelegram(request), id);
  });
  app.post("/v1/miniapp/households/join", async (request) => homes.join(requireTelegram(request), codeSchema.parse(request.body).code));
  app.post("/v1/miniapp/households/invite", async (request) => homes.invite("member", access(request)));
  app.get("/v1/miniapp/households/members", async (request) => ({ members: homes.members(access(request)) }));
  app.delete("/v1/miniapp/households/members/:userId", async (request) => {
    const { userId } = z.object({ userId: z.string().regex(/^\d{1,20}$/) }).parse(request.params);
    const auth = access(request);
    homes.removeMember(auth, userId);
    const instance = instances.get(auth.homeId); instances.delete(auth.homeId); await instance?.close();
    return { ok: true };
  });
  app.get("/v1/miniapp/households/devices", async (request) => ({ devices: homes.devices(access(request)) }));
  app.delete("/v1/miniapp/households/devices/:id", async (request) => {
    homes.revokeDevice(access(request), z.object({ id: idSchema }).parse(request.params).id); return { ok: true };
  });
  app.patch("/v1/miniapp/households/labels", async (request) => {
    const auth = access(request); homes.owner(auth);
    const labels = z.object({ misha: z.string().trim().min(1).max(60), natasha: z.string().trim().min(1).max(60) }).parse(request.body);
    homes.state(auth.homeId).update((s) => { s.personLabels = labels; });
    const instance = instances.get(auth.homeId); instances.delete(auth.homeId); await instance?.close();
    return { ok: true };
  });
  app.delete("/v1/miniapp/households/current", async (request) => {
    const auth = access(request); homes.owner(auth);
    homes.delete(auth);
    const instance = instances.get(auth.homeId); instances.delete(auth.homeId); await instance?.close();
    const base = resolve(dataDir, "backgrounds"), target = resolve(base, idSchema.parse(auth.homeId));
    if (target.startsWith(base + (process.platform === "win32" ? "\\" : "/"))) rmSync(target, { recursive: true, force: true });
    return { ok: true };
  });
  app.post("/v1/display/pair/start", async () => homes.invite("tv"));
  app.get("/v1/display/pair/wait", async (request) => homes.wait(z.object({ pairId: z.string().min(8).max(128) }).parse(request.query).pairId));
  app.post("/v1/miniapp/pair/invite", async (request) => homes.invite("phone", access(request)));
  app.post("/v1/miniapp/pair/approve", async (request) => {
    const hasAuth = request.headers["x-telegram-init-data"] || request.headers["x-dino-home-token"];
    const auth = hasAuth ? access(request) : undefined;
    const result = homes.approve(codeSchema.parse(request.body).code, auth);
    homes.state(result.householdId).update((s) => { s.tvLinked = true; });
    return result;
  });
  app.post("/v1/miniapp/access/revoke", async (request) => {
    const auth = access(request); homes.revokeAll(auth);
    homes.state(auth.homeId).update((s) => { s.tvLinked = false; }); return { ok: true };
  });
  for (const route of [
    { method: "GET", url: "/v1/display/snapshot" }, { method: "POST", url: "/v1/display/now-playing" },
  ] as const) app.route({ ...route, handler: async (request, reply) => forward(tvAccess(request).homeId, request, reply, request.url, () => tvAccess(request)) });
  // Только перечисленные маршруты достижимы снаружи. Внутренние заголовки клиента никогда не пересылаются.
  for (const route of [
    { method: "GET", url: "/v1/miniapp/state", owner: false },
    { method: "PATCH", url: "/v1/miniapp/display", owner: false },
    { method: "POST", url: "/v1/miniapp/music", owner: false },
    { method: "POST", url: "/v1/miniapp/tv", owner: false },
    { method: "POST", url: "/v1/miniapp/background", owner: false },
    { method: "POST", url: "/v1/miniapp/calendars/connect", owner: true },
    { method: "GET", url: "/v1/miniapp/calendars/:person", owner: true },
    { method: "PATCH", url: "/v1/miniapp/calendars/:person", owner: true },
    { method: "POST", url: "/v1/miniapp/calendars/disconnect", owner: true },
  ] as const) app.route({ method: route.method, url: route.url, handler: async (request, reply) => {
    const auth = access(request);
    let person: Person | undefined;
    if (route.owner) {
      person = z.object({ person: z.enum(people) }).parse(request.method === "GET" || request.method === "PATCH" ? request.params : request.body).person;
      if (!homes.calendarAccess(auth, person)) fail(403, "Этот календарь подключил другой участник");
    }
    if (request.method !== "GET" && !attempts.allow("write:" + auth.homeId, 120, 60_000)) fail(429, "Слишком много команд для этого дома");
    return forward(auth.homeId, request, reply, request.url, () => { const current = access(request); if (person && !homes.calendarAccess(current, person)) fail(403, "Доступ к календарю изменился"); });
  } });
  app.get("/v1/media/background/:homeId/:id", async (request, reply) => {
    const { homeId, id } = z.object({ homeId: idSchema, id: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/) }).parse(request.params);
    const { expires, signature } = z.object({ expires: z.coerce.number(), signature: z.string().max(128) }).parse(request.query);
    if (!mediaAllowed(homeId + "/" + id, expires, signature, config.TOKEN_ENCRYPTION_KEY)) fail(401, "Ссылка недействительна");
    return forward(homeId, request, reply, "/v1/media/background/" + id + "?" + new URLSearchParams({ expires: String(expires), signature }));
  });
  app.get("/v1/media/background/:id", async (_, reply) => reply.code(401).send({ error: "Получите новую ссылку на фон" }));
  app.post("/v1/telegram/webhook", async (request, reply) => {
    if (request.headers["x-telegram-bot-api-secret-token"] !== config.TELEGRAM_WEBHOOK_SECRET) return reply.code(401).send({ ok: false });
    const message = parseTelegramUpdate(request.body)?.message;
    if (!message?.text || !message.from || message.chat.id !== message.from.id) return { ok: true };
    const userId = String(message.from.id);
    if (!attempts.allow("bot:" + userId, 30, 60_000)) return { ok: true };
    const list = homes.list(userId);
    if (!list.length) return telegramWebhookReply(message.chat.id, { openMiniApp: true, text: config.REGISTRATION_OPEN
      ? "Привет! Давай настроим твой домашний экран. Открой приложение ниже: создай дом, подключи календарь и введи код с телевизора. Данные других домов тебе не видны."
      : "Привет! Новые дома пока не создаём, но ты можешь принять приглашение в существующий дом. Открой приложение ниже." }, config.TELEGRAM_WEB_APP_URL);
    if (/^\/(?:start|home|homes)(?:@\w+)?(?:\s|$)/i.test(message.text)) {
      const selected = homes.access(userId);
      const name = list.find((h) => h.id === selected.homeId)!.name;
      return telegramWebhookReply(message.chat.id, { openMiniApp: true, text: `Сейчас управляем домом «${name}». Темы, календари и участники — в приложении. Там же можно переключить дом.` }, config.TELEGRAM_WEB_APP_URL);
    }
    return forward(homes.access(userId).homeId, request, reply);
  });
  app.setErrorHandler((error, _, reply) => {
    const status = error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500;
    app.log.warn({ statusCode: status }, "request failed");
    reply.code(status).send({ error: status >= 500 ? "Сервис временно недоступен" : error instanceof z.ZodError ? "Проверьте введённые данные" : (error as Error).message });
  });
  app.addHook("onClose", async () => { await Promise.all([...instances.values()].map((instance) => instance.close())); instances.clear(); homes.close(); });
  return app;
}
function publicPage(title: string, heading: string, text: string) {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{max-width:44rem;margin:8vh auto;padding:2rem;background:#191b18;color:#ece7da;font:18px/1.7 system-ui}h1{font:48px Georgia}a{color:#d1a466}nav{display:flex;gap:1rem}</style><nav><a href="/">Dino TV</a><a href="/privacy">Конфиденциальность</a><a href="/terms">Условия</a></nav><h1>${heading}</h1><p>${text}</p></html>`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig(), app = createApp(config);
  app.listen({ port: config.PORT, host: "0.0.0.0" }).catch(() => { app.log.error("Не удалось запустить сервер"); process.exit(1); });
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void app.close(); });
}
