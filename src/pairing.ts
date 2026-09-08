import { randomBytes } from "node:crypto";
import type { StoredPairing } from "./types.js";

export interface Pairing {
  pairId: string;
  code: string;
  session?: string;
  expiresAt: number;
}

export interface PairingPersistence {
  load: () => StoredPairing[];
  save: (pairings: StoredPairing[]) => void;
}

export class PairingDesk {
  private readonly pairings = new Map<string, Pairing>();

  constructor(private readonly persistence?: PairingPersistence) {
    for (const item of persistence?.load() ?? []) {
      this.pairings.set(item.pairId, { ...item });
    }
  }

  start(now = Date.now()): Pairing {
    this.forgetExpired(now);
    // Keep the same waiting code for the full TTL. Multiple TV WebViews and
    // phone "show code" taps used to call start() and rotate the digits every
    // few seconds, so nobody could type them in time.
    const waiting = [...this.pairings.values()].find((item) => !item.session);
    if (waiting) return waiting;
    const pairing: Pairing = {
      pairId: randomBytes(16).toString("hex"),
      code: String(100_000 + Math.floor(Math.random() * 900_000)),
      expiresAt: now + 10 * 60 * 1000,
    };
    this.pairings.set(pairing.pairId, pairing);
    this.touch();
    return pairing;
  }

  waitingCode(now = Date.now()): string | undefined {
    this.forgetExpired(now);
    const open = [...this.pairings.values()];
    // Prefer a brand-new code; otherwise keep showing the same digits until
    // they expire so a second phone can still join after the first one did.
    return open.find((item) => !item.session)?.code ?? open[0]?.code;
  }

  status(pairId: string, now = Date.now()): { status: "waiting" | "ready" | "expired"; session?: string } {
    this.forgetExpired(now);
    const pairing = this.pairings.get(pairId);
    if (!pairing || pairing.expiresAt < now) return { status: "expired" };
    if (pairing.session) return { status: "ready", session: pairing.session };
    return { status: "waiting" };
  }

  approve(code: string, session: string, now = Date.now()): boolean {
    this.forgetExpired(now);
    const pairing = [...this.pairings.values()].find((item) => item.code === code);
    if (!pairing || pairing.expiresAt < now) return false;
    if (!pairing.session) {
      pairing.session = session;
      this.touch();
    }
    return true;
  }

  private forgetExpired(now: number): void {
    let changed = false;
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt < now) {
        this.pairings.delete(id);
        changed = true;
      }
    }
    if (changed) this.touch();
  }

  private touch(): void {
    this.persistence?.save(
      [...this.pairings.values()].map(({ pairId, code, session, expiresAt }) => ({
        pairId,
        code,
        session,
        expiresAt,
      })),
    );
  }
}
