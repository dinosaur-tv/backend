import { createHmac, timingSafeEqual } from "node:crypto";

/** Bounded, fail-closed single-process limiter. Do not run multiple replicas. */
export class AttemptLimiter {
  private readonly buckets = new Map<string, { count: number; until: number }>();
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    for (const [id, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(id);
    const bucket = this.buckets.get(key);
    if (bucket) return ++bucket.count <= limit;
    if (this.buckets.size >= 10_000) return false;
    this.buckets.set(key, { count: 1, until: now + windowMs });
    return true;
  }
}

export function requireRemoteEnabled(enabled: boolean): void {
  if (!enabled) throw Object.assign(new Error("Экспериментальный пульт выключен владельцем сервера"), { statusCode: 403 });
}

export function signMedia(id: string, expires: number, key: string): string {
  return createHmac("sha256", key).update(`background:${id}:${expires}`).digest("hex");
}

export function mediaAllowed(id: string, expires: number, signature: string, key: string, now = Date.now()): boolean {
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + 3_600_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signMedia(id, expires, key), "hex"));
}
