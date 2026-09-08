import { randomBytes } from "node:crypto";

export interface Pairing {
  pairId: string;
  code: string;
  session?: string;
  expiresAt: number;
}

export class PairingDesk {
  private readonly pairings = new Map<string, Pairing>();

  start(now = Date.now()): Pairing {
    this.forgetExpired(now);
    for (const [id, pairing] of this.pairings) {
      if (!pairing.session) this.pairings.delete(id);
    }
    const pairing: Pairing = {
      pairId: randomBytes(16).toString("hex"),
      code: String(100_000 + Math.floor(Math.random() * 900_000)),
      expiresAt: now + 10 * 60 * 1000,
    };
    this.pairings.set(pairing.pairId, pairing);
    return pairing;
  }

  waitingCode(now = Date.now()): string | undefined {
    this.forgetExpired(now);
    return [...this.pairings.values()].find((item) => !item.session)?.code;
  }

  status(pairId: string, now = Date.now()): { status: "waiting" | "ready" | "expired"; session?: string } {
    const pairing = this.pairings.get(pairId);
    if (!pairing || pairing.expiresAt < now) return { status: "expired" };
    if (pairing.session) return { status: "ready", session: pairing.session };
    return { status: "waiting" };
  }

  approve(code: string, session: string, now = Date.now()): boolean {
    this.forgetExpired(now);
    const pairing = [...this.pairings.values()].find((item) => item.code === code);
    if (!pairing) return false;
    pairing.session = session;
    return true;
  }

  private forgetExpired(now: number): void {
    for (const [id, pairing] of this.pairings) {
      if (pairing.expiresAt < now) this.pairings.delete(id);
    }
  }
}
