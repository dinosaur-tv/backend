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
  private pending: TvCommand | undefined;

  constructor(private readonly now = () => Date.now()) {}

  snapshot(): { command?: TvCommand } {
    return { command: this.pending };
  }

  launch(app: TvApp): TvCommand {
    this.pending = { action: "launch", app, at: new Date(this.now()).toISOString() };
    return this.pending;
  }

  key(key: TvKey): TvCommand {
    this.pending = { action: "key", key, at: new Date(this.now()).toISOString() };
    return this.pending;
  }
}
