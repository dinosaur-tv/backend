import { createHash, randomBytes } from "node:crypto";
import type { StateStore } from "./store.js";
import type { Person } from "./types.js";

/** Opaque, one-use OAuth capabilities. Persisted hashes survive a backend restart. */
export class OAuthStates {
  constructor(private readonly store: StateStore, private readonly now = () => Date.now(), private readonly namespace = "") {}

  issue(person: Person, userId?: string): string {
    const token = (this.namespace ? this.namespace + "." : "") + randomBytes(32).toString("base64url");
    this.store.update((stored) => {
      stored.oauthStates = Object.fromEntries(Object.entries(stored.oauthStates ?? {})
        .filter(([, value]) => value.expiresAt > this.now()).slice(-7));
      stored.oauthVersions ??= {};
      const version = (stored.oauthVersions[person] ?? 0) + 1;
      stored.oauthVersions[person] = version;
      stored.oauthStates[this.hash(token)] = { person, userId, version, expiresAt: this.now() + 900_000 };
    });
    return token;
  }

  consume(token: string): { person: Person; userId?: string; version: number } {
    const hash = this.hash(token);
    const pending = this.store.read().oauthStates?.[hash];
    if (!pending || pending.expiresAt <= this.now() || !pending.version) {
      throw Object.assign(new Error("OAuth-ссылка истекла или уже использована. Подключите календарь заново."), { statusCode: 400 });
    }
    this.store.update((stored) => { delete stored.oauthStates?.[hash]; });
    return { person: pending.person, version: pending.version, ...(pending.userId ? { userId: pending.userId } : {}) };
  }

  isCurrent(person: Person, version: number): boolean {
    return this.store.read().oauthVersions?.[person] === version;
  }

  invalidate(person: Person): void {
    this.store.update((stored) => {
      stored.oauthVersions ??= {};
      stored.oauthVersions[person] = (stored.oauthVersions[person] ?? 0) + 1;
      for (const [key, pending] of Object.entries(stored.oauthStates ?? {})) {
        if (pending.person === person) delete stored.oauthStates?.[key];
      }
    });
  }

  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
}
