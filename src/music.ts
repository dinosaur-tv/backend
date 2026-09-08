import type { NowPlaying } from "./types.js";

export const musicActions = ["play", "pause", "toggle", "next", "previous", "volume", "toTv"] as const;
export type MusicAction = (typeof musicActions)[number];

export type MusicCommand = {
  action: MusicAction;
  volume?: number;
  at: string;
};

function clip(value: string, max = 180) {
  return value.trim().slice(0, max);
}

function volumePercent(value: unknown, fallback = 50) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return fallback;
  return Math.max(0, Math.min(100, Math.round(volume)));
}

export function heardNowPlaying(value: unknown, previous?: NowPlaying): NowPlaying | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === "string" ? clip(raw.title) : "";
  if (!title) return undefined;
  const artwork = typeof raw.artworkUrl === "string" ? raw.artworkUrl.trim() : "";
  const hasVolume = raw.volumePercent !== undefined && raw.volumePercent !== null && Number.isFinite(Number(raw.volumePercent));
  return {
    title,
    artist: typeof raw.artist === "string" ? clip(raw.artist) : "",
    source: typeof raw.source === "string" && raw.source.trim() ? clip(raw.source, 80) : "Яндекс Музыка",
    isPlaying: raw.isPlaying !== false,
    volumePercent: hasVolume ? volumePercent(raw.volumePercent) : (previous?.volumePercent ?? 50),
    artworkUrl: artwork.startsWith("http://") || artwork.startsWith("https://") ? artwork.slice(0, 500) : "",
    deviceName: typeof raw.deviceName === "string" && raw.deviceName.trim() ? clip(raw.deviceName, 40) : "Телевизор",
  };
}

export class MusicDesk {
  private nowPlaying: NowPlaying | undefined;
  private heardAt = 0;
  private pending: MusicCommand | undefined;

  constructor(
    private readonly token?: string,
    private readonly now = () => Date.now(),
    private readonly liveMs = 20_000,
  ) {}

  hearFromTv(value: unknown) {
    this.nowPlaying = heardNowPlaying(value, this.nowPlaying);
    this.heardAt = this.now();
  }

  live() {
    return Boolean(this.nowPlaying?.title) && this.now() - this.heardAt < this.liveMs;
  }

  snapshot(): { connected: boolean; nowPlaying?: NowPlaying; command?: MusicCommand } {
    const track = this.live() ? this.nowPlaying : undefined;
    return {
      connected: Boolean(track?.title || this.token),
      nowPlaying: track,
      command: this.pending,
    };
  }

  async command(action: MusicAction, volume?: number): Promise<{ connected: boolean; nowPlaying?: NowPlaying; command?: MusicCommand }> {
    if (action === "toTv") {
      return this.snapshot();
    }
    if (!this.live()) {
      if (!this.token) {
        throw Object.assign(new Error("На телевизоре сейчас тихо. Запустите Яндекс Музыку в Кинопоиске — пульт подхватит трек."), { statusCode: 503 });
      }
      throw Object.assign(new Error("Откройте Кинопоиск на телевизоре — пульт подхватит плеер."), { statusCode: 503 });
    }
    this.pending = {
      action,
      volume: action === "volume" ? volumePercent(volume, this.nowPlaying?.volumePercent ?? 50) : undefined,
      at: new Date(this.now()).toISOString(),
    };
    if (action === "volume" && this.nowPlaying) {
      this.nowPlaying = { ...this.nowPlaying, volumePercent: this.pending.volume ?? this.nowPlaying.volumePercent };
    }
    if (action === "pause" && this.nowPlaying) this.nowPlaying = { ...this.nowPlaying, isPlaying: false };
    if (action === "play" && this.nowPlaying) this.nowPlaying = { ...this.nowPlaying, isPlaying: true };
    if (action === "toggle" && this.nowPlaying) this.nowPlaying = { ...this.nowPlaying, isPlaying: !this.nowPlaying.isPlaying };
    return this.snapshot();
  }
}
