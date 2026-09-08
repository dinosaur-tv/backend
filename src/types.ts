export const people = ["misha", "natasha"] as const;
export type Person = (typeof people)[number];

export const displayModes = ["NOW", "TODAY", "WEEK"] as const;
export type DisplayMode = (typeof displayModes)[number];

export const displayThemes = [
  "gallery", "home-day", "home-evening", "night", "play", "forest", "mountains", "sea", "space",
  "petersburg", "rome", "florence", "venice", "palace", "oak-study", "rus", "byzantium", "india", "italy",
] as const;
export type DisplayTheme = (typeof displayThemes)[number];

export const displayMoods = ["home", "night", "play"] as const;
export type DisplayMood = (typeof displayMoods)[number];

export interface OAuthConnection {
  refreshToken: string;
  calendarIds: string[];
  connectedAt: string;
}

export interface DisplayNote {
  text: string;
  expiresAt: string;
}

export const noteDurationsMin = [5, 10, 15, 30, 45, 60, 120, 240, 360, 720] as const;
export type NoteMinutes = (typeof noteDurationsMin)[number];

export function parseNoteMinutes(value?: number): NoteMinutes {
  if (value === undefined) return 60;
  if ((noteDurationsMin as readonly number[]).includes(value)) return value as NoteMinutes;
  throw Object.assign(new Error("Выберите, сколько держать заметку"), { statusCode: 400 });
}

export function noteExpiresAt(minutes: NoteMinutes, now = Date.now()) {
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export function liveNote(note: DisplayNote | undefined, now = Date.now()) {
  if (!note?.text) return undefined;
  if (new Date(note.expiresAt).getTime() <= now) return undefined;
  return note;
}

export interface DisplayBackground {
  id: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

export interface DisplayRotation {
  enabled: boolean;
  now: number;
  today: number;
  week: number;
}

export const rotationSecondsMin = 5;
export const rotationSecondsMax = 300;

export function parseRotationSeconds(value: unknown, fallback = 30): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(rotationSecondsMax, Math.max(rotationSecondsMin, Math.round(n)));
}

export function defaultRotation(): DisplayRotation {
  return { enabled: true, now: 30, today: 30, week: 30 };
}

export function normalizeRotation(value?: Partial<DisplayRotation> & { seconds?: number; interval?: number }): DisplayRotation {
  const base = defaultRotation();
  if (!value) return base;
  const shared = value.seconds ?? value.interval;
  return {
    enabled: value.enabled !== false,
    now: parseRotationSeconds(value.now ?? shared, base.now),
    today: parseRotationSeconds(value.today ?? shared, base.today),
    week: parseRotationSeconds(value.week ?? shared, base.week),
  };
}

export interface DisplaySettings {
  mode: DisplayMode;
  theme: DisplayTheme;
  mood: DisplayMood;
  privacy: boolean;
  showWeather: boolean;
  showCalendar: boolean;
  note?: DisplayNote;
  background?: DisplayBackground;
  rotation: DisplayRotation;
}

export interface StoredState {
  oauth: Partial<Record<Person, OAuthConnection>>;
  display: DisplaySettings;
  tvSession?: string;
  tvLinked?: boolean;
  tvReloadAt?: string;
  tvPower?: "on" | "off";
  tvPowerAt?: string;
  homeTokens?: string[];
}

export interface SnapshotEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  calendarName: string;
  ownerName: string;
  color: string;
  allDay: boolean;
}

export interface WeatherPeriod {
  id: string;
  label: string;
  hour: number;
  temperature: number;
  description: string;
}

export interface WeatherHour {
  time: string;
  hour: number;
  temperature: number;
  description: string;
}

export interface WeatherDay {
  date: string;
  high: number;
  low: number;
  description: string;
  periods: WeatherPeriod[];
}

export interface WeatherSnapshot {
  temperature: number;
  feelsLike: number;
  description: string;
  high: number;
  low: number;
  location: string;
  periods: WeatherPeriod[];
  hours: WeatherHour[];
  days: WeatherDay[];
}

export interface NowPlaying {
  title: string;
  artist: string;
  source: string;
  isPlaying: boolean;
  volumePercent: number;
  artworkUrl?: string;
  deviceName?: string;
}
