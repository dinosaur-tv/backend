import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayBackground } from "./types.js";

const maxBytes = 3_500_000;

export class MediaError extends Error {
  statusCode = 400;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sniffMime(buffer: Buffer): DisplayBackground["mime"] {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  throw new MediaError("Нужен JPEG, PNG или WebP");
}

export function decodeImagePayload(image: string): Buffer {
  const match = image.trim().match(/^(?:data:(image\/(?:jpeg|png|webp));base64,)?([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new MediaError("Не получилось прочитать картинку");
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new MediaError("Файл пустой");
  if (buffer.length > maxBytes) throw new MediaError("Картинка больше 3.5 МБ — возьмите чуть легче");
  sniffMime(buffer);
  return buffer;
}

export class BackgroundStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  save(image: string): DisplayBackground {
    const buffer = decodeImagePayload(image);
    const mime = sniffMime(buffer);
    const id = randomBytes(18).toString("base64url");
    writeFileSync(this.pathFor(id), buffer, { mode: 0o600 });
    return { id, mime };
  }

  read(id: string): { buffer: Buffer; mime: DisplayBackground["mime"] } | undefined {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
    const path = this.pathFor(id);
    if (!existsSync(path)) return undefined;
    const buffer = readFileSync(path);
    return { buffer, mime: sniffMime(buffer) };
  }

  remove(id: string | undefined): void {
    if (!id) return;
    const path = this.pathFor(id);
    if (existsSync(path)) unlinkSync(path);
  }

  private pathFor(id: string): string {
    return join(this.directory, `${id}.img`);
  }
}
