import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { Config } from "./config.js";
import type { EncryptedStore } from "./store.js";
import type { Person, SnapshotEvent } from "./types.js";

const timezone = "Europe/Moscow";
const scopes = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

const personInfo: Record<Person, { label: string; color: string }> = {
  misha: { label: "Миша", color: "#D1A466" },
  natasha: { label: "Наташа", color: "#8EA77A" },
};

export class GoogleCalendarService {
  constructor(
    private readonly config: Config,
    private readonly store: EncryptedStore,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  authorizationUrl(person: Person): string {
    const client = this.client();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state: this.signState(person),
    });
  }

  async completeAuthorization(code: string, state: string): Promise<Person> {
    const person = this.verifyState(state);
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token; reconnect with consent");
    this.store.update((stored) => {
      stored.oauth[person] = {
        refreshToken: tokens.refresh_token!,
        calendarIds: this.config.calendarIds[person],
        connectedAt: new Date().toISOString(),
      };
    });
    return person;
  }

  async eventsForNextMonth(): Promise<SnapshotEvent[]> {
    const state = this.store.read();
    const beginning = new Date();
    beginning.setHours(0, 0, 0, 0);
    const ending = new Date(beginning);
    ending.setDate(ending.getDate() + 31);

    const groups = await Promise.all(
      (Object.keys(personInfo) as Person[]).map(async (person) => {
        const connection = state.oauth[person];
        if (!connection) return [];
        const client = this.client();
        client.setCredentials({ refresh_token: connection.refreshToken });
        const calendar = google.calendar({ version: "v3", auth: client });
        const ids = connection.calendarIds.length ? connection.calendarIds : ["primary"];
        const calendars = await Promise.all(ids.map(async (calendarId) => {
          const response = await calendar.events.list({
            calendarId,
            timeMin: beginning.toISOString(),
            timeMax: ending.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            timeZone: timezone,
          });
          return response.data.items ?? [];
        }));
        return calendars.flat().flatMap((event): SnapshotEvent[] => {
          const start = event.start?.dateTime ?? event.start?.date;
          const end = event.end?.dateTime ?? event.end?.date;
          if (!start || !end) return [];
          return [{
            id: `${person}:${event.id ?? randomBytes(6).toString("hex")}`,
            title: event.summary?.trim() || "Без названия",
            start,
            end,
            calendarName: personInfo[person].label,
            ownerName: personInfo[person].label,
            color: personInfo[person].color,
            allDay: Boolean(event.start?.date),
          }];
        });
      }),
    );
    return groups.flat().sort((a, b) => a.start.localeCompare(b.start));
  }

  private client() {
    if (!this.config.GOOGLE_CLIENT_ID || !this.config.GOOGLE_CLIENT_SECRET) {
      throw new Error("Google Calendar OAuth is not configured yet");
    }
    return new google.auth.OAuth2(
      this.config.GOOGLE_CLIENT_ID,
      this.config.GOOGLE_CLIENT_SECRET,
      `${this.config.PUBLIC_BASE_URL}/oauth/google/callback`,
    );
  }

  private signState(person: Person): string {
    const issuedAt = Date.now().toString();
    const nonce = randomBytes(16).toString("base64url");
    const payload = `${person}.${issuedAt}.${nonce}`;
    return `${payload}.${this.signature(payload)}`;
  }

  private verifyState(state: string): Person {
    const parts = state.split(".");
    if (parts.length !== 4) throw new Error("Invalid OAuth state");
    const [person, issuedAt, nonce, signature] = parts;
    if (person !== "misha" && person !== "natasha") throw new Error("Invalid OAuth person");
    if (Date.now() - Number(issuedAt) > 15 * 60 * 1000) throw new Error("OAuth state expired");
    const payload = `${person}.${issuedAt}.${nonce}`;
    const received = Buffer.from(signature);
    const expected = Buffer.from(this.signature(payload));
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Invalid OAuth state signature");
    return person;
  }

  private signature(payload: string): string {
    return createHmac("sha256", this.config.TOKEN_ENCRYPTION_KEY).update(payload).digest("base64url");
  }
}
