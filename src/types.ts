export const people = ["misha", "natasha"] as const;
export type Person = (typeof people)[number];

export const displayModes = ["NOW", "TODAY", "WEEK"] as const;
export type DisplayMode = (typeof displayModes)[number];

export const displayThemes = ["forest", "stone", "tobacco", "taupe", "apple", "gallery"] as const;
export type DisplayTheme = (typeof displayThemes)[number];

export interface OAuthConnection {
  refreshToken: string;
  calendarIds: string[];
  connectedAt: string;
}

export interface DisplayNote {
  text: string;
  expiresAt: string;
}

export interface DisplayBackground {
  id: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

export interface DisplaySettings {
  mode: DisplayMode;
  theme: DisplayTheme;
  privacy: boolean;
  note?: DisplayNote;
  background?: DisplayBackground;
}

export interface StoredState {
  oauth: Partial<Record<Person, OAuthConnection>>;
  display: DisplaySettings;
  tvSession?: string;
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

export interface WeatherSnapshot {
  temperature: number;
  feelsLike: number;
  description: string;
  high: number;
  low: number;
  location: string;
  periods: WeatherPeriod[];
  hours: WeatherHour[];
}
