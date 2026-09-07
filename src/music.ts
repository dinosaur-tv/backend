import type { NowPlaying } from "./types.js";

export const musicActions = ["play", "pause", "toggle", "next", "previous", "volume", "toTv"] as const;
export type MusicAction = (typeof musicActions)[number];

export class MusicDesk {
  private nowPlaying: NowPlaying | undefined;

  constructor(private readonly token?: string) {}

  snapshot(): { connected: boolean; nowPlaying?: NowPlaying } {
    return { connected: Boolean(this.token), nowPlaying: this.nowPlaying };
  }

  async command(action: MusicAction, _volume?: number): Promise<{ connected: boolean; nowPlaying?: NowPlaying }> {
    if (action === "toTv") {
      throw Object.assign(new Error("С пульта трек на ТВ сам не уезжает. В Яндекс Музыке на телефоне нажмите значок колонки и выберите телевизор / Кинопоиск."), { statusCode: 409 });
    }
    if (!this.token) {
      throw Object.assign(new Error("Яндекс Музыка на сервере ещё не подключена."), { statusCode: 503 });
    }
    throw Object.assign(new Error("Откройте Кинопоиск на телевизоре — пульт подхватит плеер, как только Яндекс отдаст устройства."), { statusCode: 503 });
  }
}
