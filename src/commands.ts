import { displayThemes, type DisplayMode, type DisplayTheme, type StoredState } from "./types.js";

export type TelegramReply = { text: string; openMiniApp?: boolean };

const quickCommands: Record<string, string> = {
  "🕰 Сейчас": "/now",
  "☀️ Сегодня": "/today",
  "🗓 Неделя": "/week",
  "🎨 Галерея": "/theme gallery",
  "🙈 Гостевой режим": "/privacy on",
  "📡 Статус": "/status",
};

const modeNames: Record<DisplayMode, string> = {
  NOW: "«Сейчас»",
  TODAY: "«Сегодня»",
  WEEK: "«Неделя»",
};

export function handleTelegramCommand(
  text: string,
  update: (mutator: (state: StoredState) => void) => StoredState,
  connected: { misha: boolean; natasha: boolean },
): TelegramReply {
  const normalizedText = quickCommands[text.trim()] ?? text.trim();
  const [commandWithBot, ...argumentsList] = normalizedText.split(/\s+/);
  const command = commandWithBot.toLowerCase().split("@")[0];
  const argument = argumentsList.join(" ");

  if (command === "/now" || command === "/today" || command === "/week") {
    const mode = command.slice(1).toUpperCase() as DisplayMode;
    update((state) => { state.display.mode = mode; });
    return { text: `Готово — на экране ${modeNames[mode]}. Через пару секунд телевизор сам подхватит.` };
  }
  if (command === "/month") {
    update((state) => { state.display.mode = "WEEK"; });
    return { text: "Месяц мы убрали — слишком шумно для гостиной. Показал неделю, она читается спокойнее." };
  }
  if (command === "/theme") {
    if (!(displayThemes as readonly string[]).includes(argument)) {
      return { text: "Выберите тему: gallery, tobacco, taupe, stone, forest или apple. Или откройте консоль — там это красивее." };
    }
    update((state) => { state.display.theme = argument as DisplayTheme; });
    return { text: `Тема «${argument}» уже едет на телевизор. Очень идёт вашей гостиной.` };
  }
  if (command === "/privacy") {
    if (argument !== "on" && argument !== "off") {
      return { text: "Напишите /privacy on, если дома гости, или /privacy off, когда можно снова показать дела." };
    }
    update((state) => { state.display.privacy = argument === "on"; });
    return { text: argument === "on" ? "Гостевой режим включён — на экране остались время и погода." : "Календарь снова на экране. Добро пожаловать домой." };
  }
  if (command === "/note") {
    if (!argument) return { text: "Напишите /note и короткое сообщение — покажу его на телевизоре на один час." };
    update((state) => {
      state.display.note = { text: argument.slice(0, 180), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    });
    return { text: "Заметка уже на экране. Через час она исчезнет сама." };
  }
  if (command === "/status") {
    return {
      text: `Календари: Миша — ${connected.misha ? "на связи" : "ещё не подключён"}; Наташа — ${connected.natasha ? "на связи" : "ещё не подключена"}. Если что-то молчит — откройте консоль, там это видно сразу.`,
    };
  }
  if (command === "/home" || command === "/start") {
    return {
      text: "Рад вас видеть. Кнопка рядом с полем ввода открывает домашнюю консоль — там экран, фон, тема и заметка в одном спокойном месте. Команды остаются в меню слева, если хочется быстро.",
      openMiniApp: true,
    };
  }
  return {
    text: "Я рядом. Откройте консоль кнопкой у поля ввода или напишите /now, /today, /week, /theme, /privacy, /note либо /status.",
  };
}
