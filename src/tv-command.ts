// Kinopoisk and Dino are what an Android TV box knows how to open; a computer under the
// television also opens the music app, VK Video, Rutube and a browser. A screen that does
// not know an app or an action simply skips it.
export const tvApps = ["kinopoisk", "dino", "yandex_music", "vk_video", "rutube", "browser"] as const;
export type TvApp = (typeof tvApps)[number];

export const tvKeys = [
  "up", "down", "left", "right", "ok", "back", "home",
  "volume_up", "volume_down", "mute", "play_pause",
  // Keys a phone keyboard cannot send as text.
  "backspace", "enter", "tab", "space",
] as const;
export type TvKey = (typeof tvKeys)[number];

export const tvClicks = ["left", "right"] as const;
export type TvClick = (typeof tvClicks)[number];

/** The longest piece of text the phone may type at once, and the furthest one swipe may move. */
export const TV_TEXT_MAX = 200;
export const TV_POINTER_MAX = 2000;

export type TvCommand =
  | { action: "launch"; app: TvApp; at: string }
  | { action: "key"; key: TvKey; at: string }
  | { action: "text"; text: string; at: string }
  | { action: "pointer"; dx: number; dy: number; at: string }
  | { action: "scroll"; dy: number; at: string }
  | { action: "click"; button: TvClick; at: string };

export class TvDesk {
  private readonly commands: TvCommand[] = [];
  private readonly waiters = new Set<() => void>();
  private seq = 0;

  constructor(
    private readonly now = () => Date.now(),
    private readonly max = 32,
  ) {}

  snapshot(): { command?: TvCommand; commands: TvCommand[] } {
    return {
      command: this.commands.at(-1),
      commands: [...this.commands],
    };
  }

  launch(app: TvApp): TvCommand {
    return this.push({ action: "launch", app, at: this.nextAt() });
  }

  key(key: TvKey): TvCommand {
    return this.push({ action: "key", key, at: this.nextAt() });
  }

  text(text: string): TvCommand {
    return this.push({ action: "text", text: text.slice(0, TV_TEXT_MAX), at: this.nextAt() });
  }

  pointer(dx: number, dy: number): TvCommand {
    return this.push({ action: "pointer", dx: clamp(dx, TV_POINTER_MAX), dy: clamp(dy, TV_POINTER_MAX), at: this.nextAt() });
  }

  scroll(dy: number): TvCommand {
    return this.push({ action: "scroll", dy: clamp(dy, TV_POINTER_MAX), at: this.nextAt() });
  }

  click(button: TvClick): TvCommand {
    return this.push({ action: "click", button, at: this.nextAt() });
  }

  /** What came after the last command a screen has played, oldest first. */
  after(at: string): TvCommand[] {
    return this.commands.filter((command) => command.at > at);
  }

  /**
   * Holds a screen's request until something new is pressed, or until `ms` passes. A
   * cursor dragged on the phone reaches the screen as it moves, not at the next poll.
   */
  async wait(at: string, ms: number): Promise<TvCommand[]> {
    if (this.after(at).length) return this.after(at);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
    return this.after(at);
  }

  private push(command: TvCommand): TvCommand {
    this.commands.push(command);
    while (this.commands.length > this.max) this.commands.shift();
    for (const wake of [...this.waiters]) wake();
    return command;
  }

  private nextAt(): string {
    this.seq += 1;
    return `${new Date(this.now()).toISOString()}#${String(this.seq).padStart(4, "0")}`;
  }
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, Math.round(value)));
}
