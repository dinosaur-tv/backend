export const people = ["misha", "natasha"] as const;
export type Person = (typeof people)[number];

export type DisplayMode = "NOW" | "TODAY" | "WEEK" | "MONTH";
export type DisplayTheme = "forest" | "stone" | "tobacco" | "taupe" | "apple";

export interface OAuthConnection {
  refreshToken: string;
  calendarIds: string[];
  connectedAt: string;
}

export interface DisplaySettings {
  mode: DisplayMode;
  theme: DisplayTheme;
  privacy: boolean;
  note?: { text: string; expiresAt: string };
}

export interface StoredState {
  oauth: Partial<Record<Person, OAuthConnection>>;
  display: DisplaySettings;
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

