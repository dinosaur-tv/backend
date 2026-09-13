import { MusicDesk } from "./music.js";
import { TvDesk } from "./tv-command.js";
import { TvPresence } from "./tv-presence.js";
import type { StoredScreen, StoredState } from "./types.js";

/** A screen that has never spoken to the server still has to be addressable. */
const unnamed = "screen";

export type Screen = { id: string; tv: TvDesk; music: MusicDesk; presence: TvPresence };

/**
 * One household, several televisions. Commands, presence and the track playing belong to
 * the screen they came from, so the kitchen does not answer the remote aimed at the hall.
 * A screen appears here the first time it asks for a snapshot, and lives until a restart —
 * everything in it is live state, never anything worth keeping on disk.
 */
export class Screens {
  private readonly rooms = new Map<string, Screen>();

  constructor(private readonly musicToken?: string) {}

  at(id: string | undefined): Screen {
    const key = id || unnamed;
    let room = this.rooms.get(key);
    if (!room) {
      room = { id: key, tv: new TvDesk(), music: new MusicDesk(this.musicToken), presence: new TvPresence() };
      this.rooms.set(key, room);
    }
    return room;
  }

  /** A screen as it is, without conjuring one that has never spoken. */
  peek(id: string | undefined): Screen | undefined {
    return this.rooms.get(id || unnamed);
  }

  /** Every screen that has ever connected, oldest first. */
  all(): Screen[] {
    return [...this.rooms.values()];
  }

  /**
   * The screens a command is meant for: the one named, or all of them. A remote that
   * names nobody is an older phone that never knew about more than one television.
   */
  addressed(id?: string): Screen[] {
    if (id) return [this.at(id)];
    return this.rooms.size ? this.all() : [this.at(undefined)];
  }

  /** True while at least one screen is awake — what a phone without a picker asks about. */
  anyOnline(state: StoredState): boolean {
    return this.all().some((room) => room.presence.online() && power(state, room.id) !== "off");
  }

  /** The track to show when no screen has been picked: whichever one is actually playing. */
  anyNowPlaying() {
    return this.all().map((room) => room.music.snapshot()).find((snapshot) => snapshot.nowPlaying)
      ?? this.all()[0]?.music.snapshot()
      ?? { connected: Boolean(this.musicToken) };
  }
}

/** A screen's own setting, or the household's, or simply on. */
export function screenState(state: StoredState, id: string | undefined): StoredScreen {
  const own = id ? state.screens?.[id] : undefined;
  return own ?? { power: state.tvPower, powerAt: state.tvPowerAt, reloadAt: state.tvReloadAt };
}

export function power(state: StoredState, id: string | undefined): "on" | "off" {
  return screenState(state, id).power === "off" ? "off" : "on";
}

/**
 * Addressing one screen writes only that screen; addressing the house writes the shared
 * fields and drops the overrides, so "выключить" from an older phone still reaches everything.
 */
export function setScreen(state: StoredState, id: string | undefined, patch: StoredScreen): void {
  if (!id) {
    if (patch.power !== undefined) { state.tvPower = patch.power; state.tvPowerAt = patch.powerAt; }
    if (patch.reloadAt !== undefined) state.tvReloadAt = patch.reloadAt;
    delete state.screens;
    return;
  }
  state.screens ??= {};
  state.screens[id] = { ...screenState(state, id), ...patch };
}
