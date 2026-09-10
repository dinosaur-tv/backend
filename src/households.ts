import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.js";
import { emptyState, EncryptedStore, type StateStore } from "./store.js";
import { people, type StoredState } from "./types.js";

export const fail = (statusCode: number, message: string): never => { throw Object.assign(new Error(message), { statusCode }); };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type Role = "owner" | "member";
export type Access = { homeId: string; userId: string; role: Role; deviceId?: string };
export type Household = { id: string; name: string; role: Role };
type Invitation = { id: string; code: string; kind: "tv" | "phone" | "member"; home_id: string | null; actor: string | null; result: string | null; expires: number };

/** Все запросы к приватным данным требуют ID дома. Соединение используется одним процессом. */
export class Households {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  constructor(private readonly dir: string, private readonly config: Config, private readonly now = () => Date.now()) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.key = Buffer.from(config.TOKEN_ENCRYPTION_KEY, "base64");
    if (this.key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY: требуется 32 байта");
    const path = join(dir, "households.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS homes (id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, active_home TEXT);
      CREATE TABLE IF NOT EXISTS members (home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('owner','member')), PRIMARY KEY(home_id,user_id));
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE, actor TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tv','phone')), token_hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, home_id TEXT REFERENCES homes(id) ON DELETE CASCADE, actor TEXT, result TEXT, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE INDEX IF NOT EXISTS devices_home ON devices(home_id);
      CREATE INDEX IF NOT EXISTS invitations_home ON invitations(home_id);`);
    this.migrate();
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private seal(value: unknown, context: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".");
  }
  private open<T>(value: string, context: string): T {
    const [iv, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as T;
  }
  exists(id: string) { return Boolean(this.db.prepare("SELECT id FROM homes WHERE id=?").get(id)); }
  state(id: string): StateStore {
    return {
      read: () => this.read(id),
      update: (mutator) => this.transaction(() => {
        const state = this.read(id); mutator(state);
        this.db.prepare("UPDATE homes SET state=? WHERE id=?").run(this.seal(state, id), id);
        return structuredClone(state);
      }),
    };
  }
  private read(id: string): StoredState {
    const row = this.db.prepare("SELECT state FROM homes WHERE id=?").get(id);
    if (!row) return fail(404, "Дом недоступен");
    return this.open<StoredState>(String(row.state), id);
  }
  list(userId: string): Household[] {
    return this.db.prepare("SELECT h.id,h.name,m.role FROM homes h JOIN members m ON h.id=m.home_id WHERE m.user_id=? ORDER BY h.rowid").all(userId) as Household[];
  }
  access(userId: string, requested?: string): Access {
    const active = this.db.prepare("SELECT active_home FROM users WHERE id=?").get(userId)?.active_home;
    const homeId = requested || (typeof active === "string" ? active : this.list(userId)[0]?.id);
    if (!homeId) return fail(409, "Создайте дом или примите приглашение");
    const row = this.db.prepare("SELECT role FROM members WHERE home_id=? AND user_id=?").get(homeId, userId);
    if (!row) return fail(403, "Нет доступа к этому дому");
    return { homeId, userId, role: row.role as Role };
  }
  select(userId: string, homeId: string) {
    const access = this.access(userId, homeId);
    this.db.prepare("UPDATE users SET active_home=? WHERE id=?").run(homeId, userId);
    return access;
  }
  owner(access: Access) {
    if (this.access(access.userId, access.homeId).role !== "owner") fail(403, "Доступно только владельцу дома");
  }
  create(userId: string, name: string): Household {
    if (!this.config.REGISTRATION_OPEN) fail(403, "Создание новых домов временно закрыто");
    return this.transaction(() => {
      if (this.list(userId).length >= 5) fail(409, "Можно участвовать максимум в пяти домах");
      if (Number(this.db.prepare("SELECT count(*) AS n FROM homes").get()!.n) >= this.config.MAX_HOUSEHOLDS) fail(503, "На сервере закончились места для новых домов");
      return this.insertHome(userId, name, emptyState());
    });
  }
  private insertHome(userId: string, name: string, state: StoredState): Household {
    const id = randomUUID();
    this.db.prepare("INSERT INTO homes VALUES (?,?,?)").run(id, name, this.seal(state, id));
    this.db.prepare("INSERT INTO users VALUES (?,?) ON CONFLICT(id) DO UPDATE SET active_home=excluded.active_home").run(userId, id);
    this.db.prepare("INSERT INTO members VALUES (?,?,'owner')").run(id, userId);
    return { id, name, role: "owner" };
  }
  members(access: Access) {
    this.owner(access);
    return this.db.prepare("SELECT user_id AS userId,role FROM members WHERE home_id=?").all(access.homeId);
  }
  devices(access: Access) {
    this.owner(access);
    return this.db.prepare("SELECT id,kind,label,created,expires FROM devices WHERE home_id=? AND expires>?").all(access.homeId, this.now());
  }
  device(token: string | undefined, kind: "tv" | "phone"): Access {
    if (!token || token.length > 256) return fail(401, "Откройте приложение из бота или привяжите устройство");
    const row = this.db.prepare("SELECT id,home_id,actor FROM devices WHERE token_hash=? AND kind=? AND expires>?").get(hash(token), kind, this.now());
    if (!row) return fail(401, "Связь устарела. Привяжите устройство заново");
    const access = this.access(String(row.actor), String(row.home_id));
    return { ...access, deviceId: String(row.id) };
  }
  private issueDevice(homeId: string, actor: string, kind: "tv" | "phone", token = randomBytes(32).toString("base64url")) {
    this.db.prepare("DELETE FROM devices WHERE expires<=?").run(this.now());
    if (Number(this.db.prepare("SELECT count(*) AS n FROM devices WHERE home_id=?").get(homeId)!.n) >= 16) fail(409, "Удалите ненужное устройство: максимум 16 на дом");
    this.db.prepare("INSERT INTO devices VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), homeId, actor, kind, hash(token), kind === "tv" ? "Телевизор" : "Телефон", this.now(), this.now() + 365 * 86400_000);
    return token;
  }
  invite(kind: "tv" | "phone" | "member", access?: Access) {
    if (kind !== "tv") {
      if (!access) return fail(401, "Требуется вход");
      this.access(access.userId, access.homeId);
      if (kind === "member") this.owner(access);
    }
    return this.transaction(() => {
      this.db.prepare("DELETE FROM invitations WHERE expires<=?").run(this.now());
      const count = Number(this.db.prepare("SELECT count(*) AS n FROM invitations").get()!.n);
      if (count >= 1000) fail(429, "Слишком много приглашений. Попробуйте позже");
      if (access && Number(this.db.prepare("SELECT count(*) AS n FROM invitations WHERE home_id=?").get(access.homeId)!.n) >= 8) fail(429, "Дождитесь истечения предыдущих приглашений");
      let code: string;
      do { code = kind === "tv" ? String(randomInt(100000, 1000000)) : String(randomInt(1_000_000_000, 10_000_000_000)); } while (this.db.prepare("SELECT id FROM invitations WHERE code=?").get(hash(code)));
      const pairId = randomBytes(32).toString("base64url"), id = hash(pairId);
      this.db.prepare("INSERT INTO invitations VALUES (?,?,?,?,?,NULL,?)").run(id, hash(code), kind, access?.homeId ?? null, access?.userId ?? null, this.now() + 600_000);
      return { code, pairId, expiresIn: 600 };
    });
  }
  wait(pairId: string) {
    const row = this.db.prepare("SELECT * FROM invitations WHERE id=? AND kind='tv' AND expires>?").get(hash(pairId), this.now()) as Invitation | undefined;
    if (!row) return { status: "expired" };
    if (!row.result) return { status: "waiting" };
    const session = this.open<string>(row.result, row.id);
    try { this.device(session, "tv"); } catch { return { status: "expired" }; }
    return { status: "ready", session };
  }
  approve(code: string, access?: Access) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM invitations WHERE code=? AND expires>? AND result IS NULL").get(hash(code), this.now()) as Invitation | undefined;
      if (!row || row.kind === "member") return fail(404, "Код не найден или истёк");
      if (row.kind === "tv") {
        if (!access) return fail(404, "Код не найден или истёк");
        this.owner(access);
        const token = this.issueDevice(access.homeId, access.userId, "tv");
        this.db.prepare("UPDATE invitations SET result=?,home_id=?,actor=? WHERE id=?").run(this.seal(token, row.id), access.homeId, access.userId, row.id);
        return { ok: true, householdId: access.homeId };
      }
      this.access(row.actor!, row.home_id!);
      if (access && access.homeId !== row.home_id) fail(409, "Для привязки телефона выйдите из другого дома");
      const token = this.issueDevice(row.home_id!, row.actor!, "phone");
      this.db.prepare("DELETE FROM invitations WHERE id=?").run(row.id);
      return { ok: true, householdId: row.home_id!, homeToken: token };
    });
  }
  join(userId: string, code: string) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM invitations WHERE code=? AND kind='member' AND expires>?").get(hash(code), this.now()) as Invitation | undefined;
      if (!row) return fail(404, "Приглашение не найдено или истекло");
      this.owner(this.access(row.actor!, row.home_id!));
      if (this.list(userId).some((home) => home.id === row.home_id)) fail(409, "Вы уже участник этого дома");
      if (this.list(userId).length >= 5 || Number(this.db.prepare("SELECT count(*) AS n FROM members WHERE home_id=?").get(row.home_id)!.n) >= 8) fail(409, "Достигнут лимит участников или домов");
      this.db.prepare("INSERT INTO users VALUES (?,?) ON CONFLICT(id) DO UPDATE SET active_home=excluded.active_home").run(userId, row.home_id);
      this.db.prepare("INSERT INTO members VALUES (?,?,'member')").run(row.home_id, userId);
      this.db.prepare("DELETE FROM invitations WHERE id=?").run(row.id);
      return this.access(userId, row.home_id!);
    });
  }
  revokeDevice(access: Access, id: string) {
    this.owner(access);
    this.db.prepare("DELETE FROM devices WHERE home_id=? AND id=?").run(access.homeId, id);
  }
  revokeAll(access: Access) {
    this.owner(access);
    this.transaction(() => {
      this.db.prepare("DELETE FROM devices WHERE home_id=?").run(access.homeId);
      this.db.prepare("DELETE FROM invitations WHERE home_id=?").run(access.homeId);
    });
    this.invalidateOAuth(access.homeId);
  }
  removeMember(access: Access, userId: string) {
    this.owner(access);
    this.transaction(() => {
      const target = this.access(userId, access.homeId);
      if (target.role === "owner") fail(409, "Владельца удалить нельзя. Можно удалить дом целиком");
      this.db.prepare("DELETE FROM devices WHERE home_id=? AND actor=?").run(access.homeId, userId);
      this.db.prepare("DELETE FROM invitations WHERE home_id=? AND actor=?").run(access.homeId, userId);
      this.db.prepare("DELETE FROM members WHERE home_id=? AND user_id=?").run(access.homeId, userId);
      this.db.prepare("UPDATE users SET active_home=NULL WHERE id=? AND active_home=?").run(userId, access.homeId);
    });
    this.invalidateOAuth(access.homeId);
    this.state(access.homeId).update((state) => {
      for (const person of people) if (state.oauth[person]?.userId === userId) delete state.oauth[person];
    });
  }
  delete(access: Access) {
    this.owner(access);
    this.transaction(() => {
      this.db.prepare("UPDATE users SET active_home=NULL WHERE active_home=?").run(access.homeId);
      this.db.prepare("DELETE FROM homes WHERE id=?").run(access.homeId);
      this.db.prepare("DELETE FROM users WHERE id NOT IN (SELECT user_id FROM members)").run();
    });
  }
  private invalidateOAuth(id: string) {
    this.state(id).update((state) => {
      state.oauthStates = {};
      state.oauthVersions = Object.fromEntries(people.map((person) => [person, (state.oauthVersions?.[person] ?? 0) + 1]));
    });
  }
  calendarAccess(access: Access, person: "misha" | "natasha") {
    const member = this.access(access.userId, access.homeId);
    const connection = this.read(access.homeId).oauth[person];
    return member.role === "owner" || !connection || connection.userId === access.userId;
  }
  private migrate() {
    if (this.db.prepare("SELECT value FROM meta WHERE key='legacy-imported'").get()) return;
    this.transaction(() => {
      const owners = [...this.config.allowedTelegramUsers];
      const legacyPath = join(this.dir, "state.enc");
      // Refusing to start beats importing the old home with nobody able to open it.
      if (existsSync(legacyPath) && !owners.length) {
        throw new Error("Найден data/state.enc от прежней однодомной установки. Укажите в TELEGRAM_ALLOWED_USER_IDS свой Telegram ID — он станет владельцем перенесённого дома. Если старый дом не нужен, уберите data/state.enc и запустите снова.");
      }
      if (owners.length) {
        const state = new EncryptedStore(legacyPath, this.config.TOKEN_ENCRYPTION_KEY).read();
        const tvSession = state.tvSession;
        delete state.tvSession; delete state.pairings; delete state.homeTokens; state.oauthStates = {};
        const home = this.insertHome(owners[0], "Мой дом", state);
        this.db.prepare("INSERT INTO meta VALUES ('legacy-home',?)").run(home.id);
        for (const userId of owners.slice(1)) {
          this.db.prepare("INSERT INTO users VALUES (?,?)").run(userId, home.id);
          this.db.prepare("INSERT INTO members VALUES (?,?,'owner')").run(home.id, userId);
        }
        for (const token of new Set([this.config.DEVICE_TOKEN, tvSession].filter((v): v is string => Boolean(v)))) this.issueDevice(home.id, owners[0], "tv", token);
        if (state.display.background) {
          const id = state.display.background.id;
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Некорректный ID старого фона");
          const old = join(this.dir, "backgrounds", id + ".img"), dir = join(this.dir, "backgrounds", home.id);
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          if (existsSync(old)) copyFileSync(old, join(dir, id + ".img"));
        }
      }
      this.db.prepare("INSERT INTO meta VALUES ('legacy-imported','1')").run();
    });
  }
  isLegacy(id: string) { return this.db.prepare("SELECT value FROM meta WHERE key='legacy-home'").get()?.value === id; }
}
