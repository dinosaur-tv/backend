import { randomBytes } from "node:crypto";
import { OAuthStates } from "./oauth-state.js";
import { google } from "googleapis";
import type { Config } from "./config.js";
import type { StateStore } from "./store.js";
import type { Person, SnapshotEvent } from "./types.js";

const timezone = "Europe/Moscow";
const scopes = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

const people = ["misha", "natasha"] as const;

export class GoogleCalendarService {
  labels(): Record<Person, { label: string; color: string }> {
    return { misha: { label: this.config.PERSON_1_NAME, color: "#D1A466" }, natasha: { label: this.config.PERSON_2_NAME, color: "#8EA77A" } };
  }
  constructor(
    private readonly config: Config,
    private readonly store: StateStore,
    private readonly namespace = "",
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  authorizationUrl(person: Person, userId?: string): string {
    const client = this.client();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state: new OAuthStates(this.store, undefined, this.namespace).issue(person, userId),
    });
  }

  async completeAuthorization(code: string, state: string): Promise<Person> {
    const states = new OAuthStates(this.store);
    const { person, version, userId } = states.consume(state);
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token; reconnect with consent");
    if (!states.isCurrent(person, version)) throw Object.assign(new Error("Подключение отменено или заменено более новым"), { statusCode: 409 });
    this.store.update((stored) => {
      stored.oauth[person] = {
        userId,
        refreshToken: tokens.refresh_token!,
        calendarIds: [],
        connectedAt: new Date().toISOString(),
      };
    });
    return person;
  }

  async eventsForNextMonth(): Promise<SnapshotEvent[]> {
    if (!this.isConfigured()) return [];
    const state = this.store.read();
    const beginning = new Date();
    beginning.setHours(0, 0, 0, 0);
    const ending = new Date(beginning);
    ending.setDate(ending.getDate() + 31);

    const groups = await Promise.all(
      people.map(async (person) => {
        const connection = state.oauth[person];
        if (!connection) return [];
        try {
          const client = this.client();
          client.setCredentials({ refresh_token: connection.refreshToken });
          const calendar = google.calendar({ version: "v3", auth: client });
          const ids = connection.calendarIds.length ? connection.calendarIds : ["primary"];
          const calendars = await Promise.all(ids.map(async (calendarId) => {
            const items = [];
            let pageToken: string | undefined;
            do {
              const response = await calendar.events.list({
              calendarId,
              timeMin: beginning.toISOString(),
              timeMax: ending.toISOString(),
              singleEvents: true,
              orderBy: "startTime",
              timeZone: timezone,
              maxResults: 250,
              pageToken,
              });
              items.push(...response.data.items ?? []);
              pageToken = response.data.nextPageToken ?? undefined;
            } while (pageToken && items.length < 1000);
            return items;
          }));
          return calendars.flat().flatMap((event): SnapshotEvent[] => {
            const start = event.start?.dateTime ?? event.start?.date;
            const end = event.end?.dateTime ?? event.end?.date;
            if (!start || !end) return [];
            return [{
              id: `${person}:${event.iCalUID ?? event.id ?? randomBytes(6).toString("hex")}:${start}`,
              title: event.summary?.trim() || "Без названия",
              start,
              end,
              calendarName: this.labels()[person].label,
              ownerName: this.labels()[person].label,
              color: this.labels()[person].color,
              allDay: Boolean(event.start?.date),
            }];
          });
        } catch {
          return [];
        }
      }),
    );
    return groups.flat().sort((a, b) => a.start.localeCompare(b.start)).slice(0, 2000);
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

  async listCalendars(person: Person) {
    const connection = this.store.read().oauth[person];
    if (!connection) throw Object.assign(new Error("Сначала подключите Google Calendar"), { statusCode: 409 });
    const client = this.client();
    client.setCredentials({ refresh_token: connection.refreshToken });
    const api = google.calendar({ version: "v3", auth: client });
    const items: { id: string; name: string; selected: boolean }[] = [];
    let pageToken: string | undefined;
    do {
      const response = await api.calendarList.list({ pageToken, maxResults: 250 });
      for (const item of response.data.items ?? []) {
        if (item.id && item.accessRole !== "freeBusyReader") items.push({ id: item.id, name: item.summary ?? item.id, selected: connection.calendarIds.length ? connection.calendarIds.includes(item.id) : Boolean(item.primary) });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken && items.length < 1000);
    return items;
  }

  async selectCalendars(person: Person, ids: string[]): Promise<void> {
    const version = this.store.read().oauthVersions?.[person];
    const allowed = new Set((await this.listCalendars(person)).map((item) => item.id));
    if (ids.some((id) => !allowed.has(id))) throw Object.assign(new Error("Календарь недоступен этому аккаунту"), { statusCode: 400 });
    this.store.update((stored) => {
      const connection = stored.oauth[person];
      if (!connection || version !== stored.oauthVersions?.[person]) throw Object.assign(new Error("Подключение изменилось. Повторите выбор календарей."), { statusCode: 409 });
      connection.calendarIds = [...new Set(ids)];
    });
  }

  disconnect(person: Person): void {
    new OAuthStates(this.store).invalidate(person);
    this.store.update((stored) => {
      delete stored.oauth[person];
      for (const [key, pending] of Object.entries(stored.oauthStates ?? {})) {
        if (pending.person === person) delete stored.oauthStates?.[key];
      }
    });
  }
}
