// «Джарвис»: a phrase in, a short answer and remote actions out. Everyday commands are
// understood here, without a model and without a network; anything else goes to an
// OpenAI-compatible model (RouterAI), which may answer and call the same actions.
import { type TvApp, tvApps } from "./tv-command.js";

export type AssistantAction =
  | { kind: "launch"; app: TvApp }
  | { kind: "music"; action: "start" | "play" | "pause" | "next" | "previous" }
  | { kind: "volume"; direction: "up" | "down" }
  | { kind: "volume_set"; level: number }
  | { kind: "screen"; power: "on" | "off" }
  | { kind: "text"; text: string };

export type AssistantAnswer = {
  reply: string;
  actions: AssistantAction[];
  /** Who understood it: the built-in phrases, the model, or nobody. */
  source: "rules" | "ai" | "none";
};

export type AssistantConfig = {
  apiKey?: string;
  model: string;
  baseUrl: string;
};

const appNames: [RegExp, TvApp, string][] = [
  [/кинопоиск/, "kinopoisk", "Кинопоиск"],
  [/рутуб|rutube/, "rutube", "Rutube"],
  [/вк|вконтакт|vk/, "vk_video", "VK Видео"],
  [/браузер|хром|chrome|интернет/, "browser", "браузер"],
  [/яндекс ?музык/, "yandex_music", "Яндекс Музыку"],
  [/дино|главн|домашн/, "dino", "Dino"],
];

/** Lower case, ё as е, no wake word and no punctuation. */
export function cleanPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/^\s*(джарвис|jarvis|жарвис|джарвиз)(?=\s|$)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The everyday commands, recognised without a model. Null when the phrase is something else. */
export function understand(text: string): AssistantAnswer | null {
  const phrase = cleanPhrase(text);
  if (!phrase) return { reply: "Слушаю.", actions: [], source: "rules" };
  const done = (reply: string, ...actions: AssistantAction[]): AssistantAnswer => ({ reply, actions, source: "rules" });

  if (/(выключи|погаси|отключи|убери) (экран|телевизор|тв)/.test(phrase)) return done("Гашу экран.", { kind: "screen", power: "off" });
  if (/(включи|разбуди|зажги) (экран|телевизор|тв)/.test(phrase)) return done("Включаю экран.", { kind: "screen", power: "on" });

  const level = phrase.match(/(громкость|звук)\s+(на\s+)?(\d{1,3})/);
  if (level) {
    const value = Math.max(0, Math.min(100, Number(level[3])));
    return done(`Громкость ${value}.`, { kind: "volume_set", level: value });
  }
  if (/(^|\s)громче(\s|$)|прибавь/.test(phrase)) return done("Громче.", { kind: "volume", direction: "up" });
  if (/(^|\s)тише(\s|$)|убавь/.test(phrase)) return done("Тише.", { kind: "volume", direction: "down" });

  if (/следующ|переключи (трек|песню)|другую песню|дальше/.test(phrase)) return done("Следующий трек.", { kind: "music", action: "next" });
  if (/предыдущ|прошл(ую|ый) (песню|трек)/.test(phrase)) return done("Предыдущий трек.", { kind: "music", action: "previous" });
  if (/^(пауза|стоп|останови|остановись|поставь на паузу|выключи музыку|хватит)( музыку)?$/.test(phrase)) return done("Пауза.", { kind: "music", action: "pause" });
  if (/^(продолжи|продолжай|играй|возобнови|сними с паузы)/.test(phrase)) return done("Продолжаю.", { kind: "music", action: "play" });

  const wantsMusic = /(включи|поставь|запусти|врубай|вруби)\s+(какую нибудь\s+|мою\s+|немного\s+)?(музык|песн|волну|мою волну)/.test(phrase)
    || /^музык[уа]$/.test(phrase);
  if (wantsMusic) return done("Включаю музыку.", { kind: "launch", app: "yandex_music" }, { kind: "music", action: "start" });

  if (/^(открой|запусти|включи|покажи|верни)(\s|$)/.test(phrase)) {
    for (const [pattern, app, name] of appNames) {
      if (pattern.test(phrase)) return done(app === "dino" ? "Возвращаю Dino." : `Открываю ${name}.`, { kind: "launch", app });
    }
  }
  if (/^(домой|на главную)$/.test(phrase)) return done("Возвращаю Dino.", { kind: "launch", app: "dino" });
  return null;
}

const SYSTEM = [
  "Ты — Джарвис, голосовой помощник домашнего телевизора Dino TV. К телевизору подключён Mac mini.",
  "Тебя слышат голосом и твой ответ будет прочитан вслух: отвечай по-русски, коротко, одним-двумя предложениями,",
  "без списков, разметки, эмодзи и ссылок. Числа и время пиши так, как их удобно произнести.",
  "Если просят что-то сделать с телевизором, музыкой, громкостью, экраном или приложениями — вызови функцию и",
  "коротко подтверди. На вопросы отвечай сам. Если не уверен, что услышал правильно, переспроси.",
].join(" ");

const tools = [
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Открыть приложение на телевизоре: kinopoisk — фильмы и сериалы, yandex_music — музыка, vk_video, rutube, browser — Chrome, dino — домашний экран с часами и расписанием.",
      parameters: { type: "object", properties: { app: { type: "string", enum: [...tvApps] } }, required: ["app"] },
    },
  },
  {
    type: "function",
    function: {
      name: "music",
      description: "Управлять Яндекс Музыкой: start — открыть и включить музыку, play — продолжить, pause, next, previous.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["start", "play", "pause", "next", "previous"] } }, required: ["action"] },
    },
  },
  {
    type: "function",
    function: {
      name: "volume",
      description: "Громкость музыки: level от 0 до 100, или direction up/down на шаг.",
      parameters: { type: "object", properties: { level: { type: "number" }, direction: { type: "string", enum: ["up", "down"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "screen",
      description: "Погасить (off) или включить (on) экран телевизора. Компьютер при этом продолжает работать.",
      parameters: { type: "object", properties: { power: { type: "string", enum: ["on", "off"] } }, required: ["power"] },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Напечатать текст в поле, которое сейчас открыто на экране (например, поиск в браузере или Кинопоиске).",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  },
] as const;

/** Turns the model's function calls into actions, dropping anything malformed. */
export function actionsFromToolCalls(calls: unknown): AssistantAction[] {
  if (!Array.isArray(calls)) return [];
  const actions: AssistantAction[] = [];
  for (const call of calls) {
    const name = call?.function?.name;
    let args: Record<string, unknown>;
    try { args = JSON.parse(call?.function?.arguments || "{}"); } catch { continue; }
    if (name === "open_app" && (tvApps as readonly string[]).includes(String(args.app))) actions.push({ kind: "launch", app: args.app as TvApp });
    if (name === "music" && ["start", "play", "pause", "next", "previous"].includes(String(args.action))) {
      if (args.action === "start") actions.push({ kind: "launch", app: "yandex_music" });
      actions.push({ kind: "music", action: args.action as "start" });
    }
    if (name === "volume") {
      if (typeof args.level === "number" && Number.isFinite(args.level)) actions.push({ kind: "volume_set", level: Math.max(0, Math.min(100, Math.round(args.level))) });
      else if (args.direction === "up" || args.direction === "down") actions.push({ kind: "volume", direction: args.direction });
    }
    if (name === "screen" && (args.power === "on" || args.power === "off")) actions.push({ kind: "screen", power: args.power });
    if (name === "type_text" && typeof args.text === "string" && args.text.trim()) actions.push({ kind: "text", text: args.text.slice(0, 200) });
  }
  return actions;
}

/** Asks the model. Without a key it says so instead of failing. */
export async function ask(text: string, config: AssistantConfig, fetchImpl: typeof fetch = fetch): Promise<AssistantAnswer> {
  if (!config.apiKey) {
    return { reply: "Это я пока не умею: умный режим ещё не подключён. Могу включить музыку, открыть приложение или погасить экран.", actions: [], source: "none" };
  }
  const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }],
      tools,
      tool_choice: "auto",
      max_tokens: 300,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Помощник не ответил (${response.status})`), { statusCode: 502 });
  const data = await response.json() as { choices?: { message?: { content?: string | null; tool_calls?: unknown } }[] };
  const message = data.choices?.[0]?.message;
  const actions = actionsFromToolCalls(message?.tool_calls);
  const reply = (message?.content ?? "").replace(/[*_`#>]/g, "").trim() || (actions.length ? "Готово." : "Не расслышал, повторите, пожалуйста.");
  return { reply: reply.slice(0, 600), actions, source: "ai" };
}

/** The whole path: built-in phrases first, the model for everything else. */
export async function answer(text: string, config: AssistantConfig, fetchImpl: typeof fetch = fetch): Promise<AssistantAnswer> {
  return understand(text) ?? ask(cleanPhrase(text) ? text.replace(/^\s*(джарвис|jarvis)[,\s]*/i, "") : text, config, fetchImpl);
}
