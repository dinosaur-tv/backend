export const tvApps = ["kinopoisk", "dino"] as const;
export type TvApp = (typeof tvApps)[number];

export const tvKeys = [
  "up", "down", "left", "right", "ok", "back", "home",
  "volume_up", "volume_down", "mute", "play_pause",
] as const;
export type TvKey = (typeof tvKeys)[number];

export type TvCommand =
  | { action: "launch"; app: TvApp; at: string }
  | { action: "key"; key: TvKey; at: string };

export class TvDesk {
  private readonly commands: TvCommand[] = [];
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

  private push(command: TvCommand): TvCommand {
    this.commands.push(command);
    while (this.commands.length > this.max) this.commands.shift();
    return command;
  }

  private nextAt(): string {
    this.seq += 1;
    return `${new Date(this.now()).toISOString()}#${String(this.seq).padStart(4, "0")}`;
  }
}
