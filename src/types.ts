/**
 * The two slots every home used to have. A home may now hold any number of calendar
 * accounts under ids of its own, but these two names still name the first homes' data.
 */
export const people = ["misha", "natasha"] as const;
/** An account's id: one of the two legacy names, or hex minted when a calendar is added. */
export type Person = string;

/** Enough colours that neighbouring calendars stay apart on the screen. */
export const calendarColors = [
  "#D1A466", "#8EA77A", "#7FA6C4", "#C58B7E", "#A98BC4", "#C4A83F", "#6FAFA2", "#C47FA0",
] as const;

/** The colour for a new account: the first one nobody in this home is wearing. */
export function freeCalendarColor(taken: Iterable<string>): string {
  const used = new Set(taken);
  return calendarColors.find((color) => !used.has(color)) ?? calendarColors[0];
}

export const displayModes = ["TODAY", "TOMORROW", "WEEK"] as const;
export type DisplayMode = (typeof displayModes)[number];

export const displayThemes = [
  "gallery", "home-day", "home-evening", "night", "play", "forest", "autumn-forest", "mountains", "sea", "space",
  "petersburg", "petersburg-streets", "oranienbaum", "peterhof", "rome", "florence", "venice", "italy-sunset",
  "palace", "oak-study", "palace-study", "rus", "gzhel", "soviet-carpet", "byzantium", "india", "italy",
] as const;
export type DisplayTheme = (typeof displayThemes)[number];

export const displayMoods = ["home", "night", "play"] as const;
export type DisplayMood = (typeof displayMoods)[number];

export interface OAuthConnection {
  userId?: string;
  refreshToken: string;
  calendarIds: string[];
  connectedAt: string;
  /** What the screen writes over these events. Filled in on the way out for older homes. */
  label?: string;
  /** The dot beside them, from `calendarColors`. */
  color?: string;
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

/** Where the screen looks up its weather. Stored per household, not baked into the code. */
export interface DisplayPlace {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const defaultPlace = (): DisplayPlace => ({
  name: "Санкт-Петербург",
  latitude: 59.9386,
  longitude: 30.3141,
  timezone: "Europe/Moscow",
});

/** Coordinates outside the globe, or a timezone the screen cannot format with, would break the forecast. */
export function normalizePlace(value: unknown): DisplayPlace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
  if (!name || !timezone || timezone.length > 64) return undefined;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return undefined;
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return undefined;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); } catch { return undefined; }
  return { name, latitude: Math.round(latitude * 1e4) / 1e4, longitude: Math.round(longitude * 1e4) / 1e4, timezone };
}

/** The labels and colours the first two slots were born with. */
const legacyCalendars: Record<string, { label: string; color: string }> = {
  misha: { label: "Участник 1", color: calendarColors[0] },
  natasha: { label: "Участник 2", color: calendarColors[1] },
};

/**
 * A home written before calendars carried their own name kept the labels in a separate
 * field — and the very first home kept them in the server's environment. Both are folded
 * into the connections on the way out, so every reader sees one shape.
 */
export function normalizeCalendars(state: StoredState, fromEnvironment: Record<string, string> = {}): void {
  const taken = Object.values(state.oauth).map((connection) => connection?.color).filter(Boolean) as string[];
  for (const [id, connection] of Object.entries(state.oauth)) {
    if (!connection) { delete state.oauth[id]; continue; }
    connection.label ||= state.personLabels?.[id] || fromEnvironment[id] || legacyCalendars[id]?.label || "Календарь";
    if (connection.color) continue;
    connection.color = legacyCalendars[id]?.color ?? freeCalendarColor(taken);
    taken.push(connection.color);
  }
}

export interface DisplayRotation {
  enabled: boolean;
  today: number;
  tomorrow: number;
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
  return { enabled: true, today: 30, tomorrow: 30, week: 30 };
}

export function normalizeRotation(value?: Partial<DisplayRotation> & { now?: number; seconds?: number; interval?: number }): DisplayRotation {
  const base = defaultRotation();
  if (!value) return base;
  const shared = value.seconds ?? value.interval;
  return {
    enabled: value.enabled !== false,
    today: parseRotationSeconds(value.today ?? value.now ?? shared, base.today),
    tomorrow: parseRotationSeconds(value.tomorrow ?? value.today ?? value.now ?? shared, base.tomorrow),
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
  place: DisplayPlace;
}

export interface StoredPairing {
  kind?: "tv" | "home";
  pairId: string;
  code: string;
  session?: string;
  expiresAt: number;
}

export interface StoredState {
  personLabels?: Record<Person, string>;
  oauthStates?: Record<string, { person: Person; userId?: string; version?: number; label?: string; expiresAt: number }>;
  oauthVersions?: Partial<Record<Person, number>>;
  oauth: Partial<Record<Person, OAuthConnection>>;
  display: DisplaySettings;
  tvSession?: string;
  tvLinked?: boolean;
  tvReloadAt?: string;
  tvPower?: "on" | "off";
  tvPowerAt?: string;
  homeTokens?: string[];
  /** Open TV / phone invite codes. Kept on disk so a backend restart does not orphan the digits on screen. */
  pairings?: StoredPairing[];
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
