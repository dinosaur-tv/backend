import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashHomeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueHomeToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashHomeToken(token) };
}

export function homeTokenAllowed(token: string | undefined, hashes: string[]): boolean {
  if (!token || token.length < 16 || hashes.length === 0) return false;
  const incoming = Buffer.from(hashHomeToken(token), "hex");
  return hashes.some((hash) => {
    const expected = Buffer.from(hash, "hex");
    return incoming.length === expected.length && timingSafeEqual(incoming, expected);
  });
}

export function rememberHomeToken(hashes: string[] | undefined, hash: string, keep = 32): string[] {
  return [...(hashes ?? []).filter((item) => item !== hash), hash].slice(-keep);
}
