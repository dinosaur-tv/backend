import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultRotation, normalizeRotation, type StoredState } from "./types.js";

const emptyState = (): StoredState => ({
  oauth: {},
  display: { mode: "NOW", theme: "gallery", mood: "home", privacy: false, showWeather: true, showCalendar: true, rotation: defaultRotation() },
});

interface CipherPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedStore {
  private state: StoredState;
  private readonly key: Buffer;

  constructor(private readonly filePath: string, base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
    this.state = this.load();
  }

  read(): StoredState {
    return structuredClone(this.state);
  }

  tvSession(): string {
    if (!this.state.tvSession) {
      this.state.tvSession = randomBytes(24).toString("base64url");
      this.persist();
    }
    return this.state.tvSession;
  }

  update(mutator: (state: StoredState) => void): StoredState {
    mutator(this.state);
    this.persist();
    return this.read();
  }

  private load(): StoredState {
    if (!existsSync(this.filePath)) return emptyState();
    const payload = JSON.parse(readFileSync(this.filePath, "utf8")) as CipherPayload;
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8")) as StoredState;
    if (String(parsed.display?.mode) === "MONTH") parsed.display.mode = "WEEK";
    if (!parsed.display?.theme) parsed.display.theme = "gallery";
    if (["stone", "tobacco", "taupe", "apple"].includes(String(parsed.display.theme))) {
      parsed.display.theme = "gallery";
    }
    if (parsed.display.theme === "night" || parsed.display.theme === "play") {
      parsed.display.mood = parsed.display.theme;
      parsed.display.theme = "gallery";
    }
    if (!parsed.display.mood) parsed.display.mood = "home";
    parsed.display.rotation = normalizeRotation(parsed.display.rotation);
    if (parsed.display.showWeather === undefined) parsed.display.showWeather = true;
    if (parsed.display.showCalendar === undefined) parsed.display.showCalendar = true;
    if (parsed.tvLinked === undefined) parsed.tvLinked = Boolean(parsed.tvSession);
    return parsed;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.state)), cipher.final()]);
    const payload: CipherPayload = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    writeFileSync(this.filePath, JSON.stringify(payload), { mode: 0o600 });
  }
}
