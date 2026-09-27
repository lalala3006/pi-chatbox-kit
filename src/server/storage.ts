import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Credential, CredentialInfo } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AppSettings, ConversationSnapshot, UserSettings } from "../shared.js";

export interface StoredConversation extends ConversationSnapshot {
  appId: string;
  userId: string;
  history: AgentMessage[];
}

export interface CredentialRef {
  appId: string;
  provider: string;
  scope: "user" | "app";
  userId?: string;
}

export interface ChatboxStore {
  getConversation(appId: string, userId: string, id: string): Promise<StoredConversation | undefined>;
  listConversations(appId: string, userId: string): Promise<StoredConversation[]>;
  saveConversation(conversation: StoredConversation): Promise<void>;
  deleteConversation(appId: string, userId: string, id: string): Promise<void>;
  getUserSettings(appId: string, userId: string): Promise<UserSettings>;
  setUserSettings(appId: string, userId: string, settings: UserSettings): Promise<void>;
  getAppSettings(appId: string): Promise<AppSettings>;
  setAppSettings(appId: string, settings: AppSettings): Promise<void>;
  readCredential(ref: CredentialRef): Promise<Credential | undefined>;
  listCredentials(appId: string, scope: CredentialRef["scope"], userId?: string): Promise<readonly CredentialInfo[]>;
  modifyCredential(ref: CredentialRef, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  deleteCredential(ref: CredentialRef): Promise<void>;
}

function ownerFor(ref: CredentialRef): string {
  if (ref.scope === "app") return "app";
  if (!ref.userId) throw new Error("userId is required for a user credential");
  return `user:${ref.userId}`;
}

class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, next);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

export class MemoryChatboxStore implements ChatboxStore {
  private conversations = new Map<string, StoredConversation>();
  private userSettings = new Map<string, UserSettings>();
  private appSettings = new Map<string, AppSettings>();
  private credentials = new Map<string, Credential>();
  private mutex = new KeyedMutex();

  private conversationKey(appId: string, userId: string, id: string) { return JSON.stringify([appId, userId, id]); }
  private userKey(appId: string, userId: string) { return JSON.stringify([appId, userId]); }
  private credentialKey(ref: CredentialRef) { return JSON.stringify([ref.appId, ownerFor(ref), ref.provider]); }

  async getConversation(appId: string, userId: string, id: string) {
    const value = this.conversations.get(this.conversationKey(appId, userId, id));
    return value ? structuredClone(value) : undefined;
  }
  async listConversations(appId: string, userId: string) {
    return [...this.conversations.values()].filter((c) => c.appId === appId && c.userId === userId).map((c) => structuredClone(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async saveConversation(conversation: StoredConversation) {
    this.conversations.set(this.conversationKey(conversation.appId, conversation.userId, conversation.id), structuredClone(conversation));
  }
  async deleteConversation(appId: string, userId: string, id: string) {
    this.conversations.delete(this.conversationKey(appId, userId, id));
  }
  async getUserSettings(appId: string, userId: string) {
    return structuredClone(this.userSettings.get(this.userKey(appId, userId)) ?? {});
  }
  async setUserSettings(appId: string, userId: string, settings: UserSettings) {
    this.userSettings.set(this.userKey(appId, userId), structuredClone(settings));
  }
  async getAppSettings(appId: string) { return structuredClone(this.appSettings.get(appId) ?? {}); }
  async setAppSettings(appId: string, settings: AppSettings) { this.appSettings.set(appId, structuredClone(settings)); }
  async readCredential(ref: CredentialRef) {
    const value = this.credentials.get(this.credentialKey(ref));
    return value ? structuredClone(value) : undefined;
  }
  async listCredentials(appId: string, scope: CredentialRef["scope"], userId?: string) {
    const owner = scope === "app" ? "app" : `user:${userId ?? ""}`;
    return [...this.credentials.entries()].flatMap(([key, value]) => {
      const [recordApp, recordOwner, providerId] = JSON.parse(key) as [string, string, string];
      return recordApp === appId && recordOwner === owner ? [{ providerId, type: value.type }] : [];
    });
  }
  async modifyCredential(ref: CredentialRef, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const key = this.credentialKey(ref);
    return this.mutex.run(key, async () => {
      const next = await fn(await this.readCredential(ref));
      if (next) this.credentials.set(key, structuredClone(next));
      return next;
    });
  }
  async deleteCredential(ref: CredentialRef) {
    await this.mutex.run(this.credentialKey(ref), async () => { this.credentials.delete(this.credentialKey(ref)); });
  }
}

export interface SqliteChatboxStoreOptions {
  path: string;
  encryptionKey: Uint8Array;
}

export class SqliteChatboxStore implements ChatboxStore {
  private db: DatabaseSync;
  private key: Buffer;
  private mutex = new KeyedMutex();

  constructor(options: SqliteChatboxStoreOptions) {
    if (options.encryptionKey.byteLength !== 32) throw new Error("encryptionKey must be 32 bytes");
    this.key = Buffer.from(options.encryptionKey);
    mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, app_id TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, app_id, owner, id))");
  }

  close() { this.db.close(); }

  private put(kind: string, appId: string, owner: string, id: string, value: unknown, encrypted = false) {
    const plain = Buffer.from(JSON.stringify(value));
    let data = plain;
    if (encrypted) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const payload = Buffer.concat([cipher.update(plain), cipher.final()]);
      data = Buffer.concat([iv, cipher.getAuthTag(), payload]);
    }
    this.db.prepare("INSERT INTO records(kind,app_id,owner,id,value,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,app_id,owner,id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(kind, appId, owner, id, data, Date.now());
  }

  private get<T>(kind: string, appId: string, owner: string, id: string, encrypted = false): T | undefined {
    const row = this.db.prepare("SELECT value FROM records WHERE kind=? AND app_id=? AND owner=? AND id=?").get(kind, appId, owner, id) as { value: Uint8Array } | undefined;
    if (!row) return undefined;
    let data = Buffer.from(row.value);
    if (encrypted) {
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      data = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
    }
    return JSON.parse(data.toString("utf8")) as T;
  }

  private remove(kind: string, appId: string, owner: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND app_id=? AND owner=? AND id=?").run(kind, appId, owner, id);
  }

  async getConversation(appId: string, userId: string, id: string) { return this.get<StoredConversation>("conversation", appId, `user:${userId}`, id); }
  async listConversations(appId: string, userId: string) {
    const rows = this.db.prepare("SELECT id FROM records WHERE kind='conversation' AND app_id=? AND owner=? ORDER BY updated_at DESC").all(appId, `user:${userId}`) as Array<{ id: string }>;
    return rows.map((row) => this.get<StoredConversation>("conversation", appId, `user:${userId}`, row.id)!).filter(Boolean);
  }
  async saveConversation(conversation: StoredConversation) { this.put("conversation", conversation.appId, `user:${conversation.userId}`, conversation.id, conversation); }
  async deleteConversation(appId: string, userId: string, id: string) { this.remove("conversation", appId, `user:${userId}`, id); }
  async getUserSettings(appId: string, userId: string) { return this.get<UserSettings>("settings", appId, `user:${userId}`, "default") ?? {}; }
  async setUserSettings(appId: string, userId: string, settings: UserSettings) { this.put("settings", appId, `user:${userId}`, "default", settings); }
  async getAppSettings(appId: string) { return this.get<AppSettings>("settings", appId, "app", "default") ?? {}; }
  async setAppSettings(appId: string, settings: AppSettings) { this.put("settings", appId, "app", "default", settings); }
  async readCredential(ref: CredentialRef) { return this.get<Credential>("credential", ref.appId, ownerFor(ref), ref.provider, true); }
  async listCredentials(appId: string, scope: CredentialRef["scope"], userId?: string) {
    const owner = scope === "app" ? "app" : `user:${userId ?? ""}`;
    const rows = this.db.prepare("SELECT id FROM records WHERE kind='credential' AND app_id=? AND owner=?").all(appId, owner) as Array<{ id: string }>;
    return rows.map(({ id }) => ({ providerId: id, type: this.get<Credential>("credential", appId, owner, id, true)!.type }));
  }
  async modifyCredential(ref: CredentialRef, fn: (current: Credential | undefined) => Promise<Credential | undefined>) {
    const key = JSON.stringify([ref.appId, ownerFor(ref), ref.provider]);
    return this.mutex.run(key, async () => {
      const next = await fn(await this.readCredential(ref));
      if (next) this.put("credential", ref.appId, ownerFor(ref), ref.provider, next, true);
      return next;
    });
  }
  async deleteCredential(ref: CredentialRef) {
    await this.mutex.run(JSON.stringify([ref.appId, ownerFor(ref), ref.provider]), async () => { this.remove("credential", ref.appId, ownerFor(ref), ref.provider); });
  }
}

export function createMemoryChatboxStore(): ChatboxStore { return new MemoryChatboxStore(); }
export function createSqliteChatboxStore(options: SqliteChatboxStoreOptions): SqliteChatboxStore { return new SqliteChatboxStore(options); }
