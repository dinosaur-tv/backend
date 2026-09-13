import { randomBytes } from "node:crypto";
import { OAuthStates } from "./oauth-state.js";
import { google } from "googleapis";
import type { Config } from "./config.js";
import type { StateStore } from "./store.js";
import { mergeShared, type TaggedEvent } from "./shared-events.js";
import { freeCalendarColor, type Person, type SnapshotEvent } from "./types.js";

const timezone = "Europe/Moscow";
const scopes = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export class GoogleCalendarService {
  /** Every calendar this home has connected, in the order it connected them. */
  accounts(): { id: Person; label: string; color: string; calendarIds: string[]; connectedBy?: string }[] {
    const state = this.store.read();
    return Object.entries(state.oauth).flatMap(([id, connection]) => connection
      ? [{ id, label: connection.label ?? "Календарь", color: connection.color ?? freeCalendarColor([]), calendarIds: connection.calendarIds, connectedBy: connection.userId }]
      : []);
  }

  constructor(
    private readonly config: Config,
    private readonly store: StateStore,
    private readonly namespace = "",
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  /**
   * Reconnecting names the account that is already there; adding one mints an id, so a
   * home is free to hold as many calendars as it has people. The label travels with the
   * pending state: the account only exists once Google has answered.
   */
  authorizationUrl(person: Person | undefined, userId?: string, label?: string): string {
    const id = person ?? randomBytes(6).toString("hex");
    const client = this.client();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state: new OAuthStates(this.store, undefined, this.namespace).issue(id, userId, label),
    });
  }

  async completeAuthorization(code: string, state: string): Promise<{ person: Person; label: string }> {
    const states = new OAuthStates(this.store);
    const { person, version, userId, label } = states.consume(state);
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token; reconnect with consent");
    if (!states.isCurrent(person, version)) throw Object.assign(new Error("Подключение отменено или заменено более новым"), { statusCode: 409 });
    let named = label ?? "Календарь";
    this.store.update((stored) => {
      const previous = stored.oauth[person];
      named = label || previous?.label || "Календарь";
      stored.oauth[person] = {
        userId,
        refreshToken: tokens.refresh_token!,
        calendarIds: previous?.calendarIds ?? [],
        connectedAt: new Date().toISOString(),
        label: named,
        color: previous?.color ?? freeCalendarColor(Object.values(stored.oauth).map((item) => item?.color ?? "")),
      };
    });
    return { person, label: named };
  }

  /** The name over these events on the screen. Changing it never touches the connection. */
  rename(person: Person, label: string): void {
    this.store.update((stored) => {
      const connection = stored.oauth[person];
      if (!connection) throw Object.assign(new Error("Этот календарь уже отключён"), { statusCode: 404 });
      connection.label = label;
    });
  }

  async eventsForNextMonth(): Promise<SnapshotEvent[]> {
    if (!this.isConfigured()) return [];
    const state = this.store.read();
    const beginning = new Date();
    beginning.setHours(0, 0, 0, 0);
    const ending = new Date(beginning);
    ending.setDate(ending.getDate() + 31);

    const groups = await Promise.all(
      Object.keys(state.oauth).map(async (person) => {
        const connection = state.oauth[person];
        if (!connection) return [];
        const label = connection.label ?? "Календарь";
        const color = connection.color ?? freeCalendarColor([]);
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
          return calendars.flat().flatMap((event): TaggedEvent[] => {
            const start = event.start?.dateTime ?? event.start?.date;
            const end = event.end?.dateTime ?? event.end?.date;
            if (!start || !end) return [];
            // Every copy of an invitation carries the same iCalUID; the instance start
            // keeps the occurrences of a weekly event apart.
            const uid = event.iCalUID ? `${event.iCalUID}:${start}` : "";
            return [{
              id: `${person}:${event.iCalUID ?? event.id ?? randomBytes(6).toString("hex")}:${start}`,
              uid,
              title: event.summary?.trim() || "Без названия",
              start,
              end,
              calendarName: label,
              ownerName: label,
              color,
              allDay: Boolean(event.start?.date),
            }];
          });
        } catch {
          return [];
        }
      }),
    );
    return mergeShared(groups.flat()).slice(0, 2000);
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
