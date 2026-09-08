import { displayThemes, type DisplayMode, type DisplayMood, type DisplayTheme, type StoredState } from "./types.js";

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
    if (!(displayThemes as readonly string[]).includes(argument) && argument !== "home") {
      return { text: "Сцены: gallery, home-day, home-evening, palace, oak-study, night, play, forest, mountains, sea, space, petersburg, rome, florence, venice, rus, byzantium, india или italy. Например: /theme palace." };
    }
    if (argument === "night" || argument === "play" || argument === "home") {
      update((state) => { state.display.mood = argument as DisplayMood; });
      const names = { home: "галерея", night: "ночь", play: "шалость" };
      return { text: `На экране режим «${names[argument]}».` };
    }
    update((state) => {
      state.display.theme = argument as DisplayTheme;
      state.display.mood = "home";
    });
    const names: Partial<Record<DisplayTheme, string>> = {
      gallery: "Галерея",
      "home-day": "Дом · День",
      "home-evening": "Дом · Вечер",
      forest: "Лес",
      mountains: "Горы",
      sea: "Море",
      space: "Космос",
      petersburg: "Петербург",
      rome: "Рим",
      florence: "Флоренция",
      venice: "Венеция",
      palace: "Дворец",
      "oak-study": "Дубовый кабинет",
      rus: "Русский узор",
      byzantium: "Византия",
      india: "Индия",
      italy: "Итальянский узор",
    };
    return { text: `Сцена «${names[argument as DisplayTheme] ?? argument}» уже оживает на телевизоре.` };
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
