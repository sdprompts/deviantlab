import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import sharp from "sharp";
import { DA_CLIENT_ID } from "../da/app";
import { DA_CLIENT_SECRET } from "../da/appSecret";
import { jpegWithCredit } from "./preprocess";
import { runVision } from "./visionServer";

const USER_AGENT = "DeviantLab/0.1 (dev)";
const ROOT = path.join(process.cwd(), ".studio");
const FILES = path.join(ROOT, "files");
const THUMBS = path.join(ROOT, "thumbs");
const DB_PATH = path.join(ROOT, "queue.sqlite");
const MARK_PATH = path.join(ROOT, "watermark.png");
const MAX_BYTES = 40_000_000;
const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;

type PostStatus = "titling" | "review" | "waiting" | "submitted" | "posting" | "published" | "stashed" | "failed";

type PostRow = {
  id: string;
  name: string;
  status: PostStatus;
  title: string;
  tags: string;
  error: string;
  itemid: string;
  url: string;
  deviation_id: string;
  created_at: number;
  mature: number;
  ai: number;
  noai: number;
  watermark: number;
  studio: number;
  published_at: number;
  galleries: string;
  feature: number;
};

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type StudioConfig = {
  scheduleMinutes: number;
  credit: string;
  visionEnabled: boolean;
  visionProvider: string;
  visionModel: string;
  visionBaseUrl: string;
  visionKey: string;
  publishMature: boolean;
  publishAi: boolean;
  publishNoai: boolean;
  defaultFolder: string;
  watermarkCorner: string;
  watermarkWidth: number;
  visionTemperature: number;
  visionTagCount: number;
};

const configDefaults: StudioConfig = {
  scheduleMinutes: 30,
  credit: "",
  visionEnabled: true,
  visionProvider: "openrouter",
  visionModel: "",
  visionBaseUrl: "",
  visionKey: "",
  publishMature: false,
  publishAi: true,
  publishNoai: false,
  defaultFolder: "featured",
  watermarkCorner: "bottom-right",
  watermarkWidth: 400,
  visionTemperature: 0.7,
  visionTagCount: 25,
};

let db: DatabaseSync | null = null;
let env: Record<string, string> = {};
const serverGlobals = globalThis as { __deviantlabQueue?: NodeJS.Timeout; __deviantlabTicking?: boolean };

function database(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      itemid TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      deviation_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns = db.prepare("PRAGMA table_info(posts)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "sort")) {
    db.exec("ALTER TABLE posts ADD COLUMN sort INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE posts SET sort = created_at");
  }
  const names = new Set(columns.map((column) => column.name));
  const addedFlag = !names.has("mature") || !names.has("ai") || !names.has("noai");
  if (!names.has("mature")) db.exec("ALTER TABLE posts ADD COLUMN mature INTEGER NOT NULL DEFAULT 0");
  if (!names.has("ai")) db.exec("ALTER TABLE posts ADD COLUMN ai INTEGER NOT NULL DEFAULT 1");
  if (!names.has("noai")) db.exec("ALTER TABLE posts ADD COLUMN noai INTEGER NOT NULL DEFAULT 0");
  if (!names.has("watermark")) db.exec("ALTER TABLE posts ADD COLUMN watermark INTEGER NOT NULL DEFAULT 1");
  if (!names.has("studio")) db.exec("ALTER TABLE posts ADD COLUMN studio INTEGER NOT NULL DEFAULT 0");
  if (!names.has("published_at")) db.exec("ALTER TABLE posts ADD COLUMN published_at INTEGER NOT NULL DEFAULT 0");
  if (!names.has("galleries")) db.exec("ALTER TABLE posts ADD COLUMN galleries TEXT NOT NULL DEFAULT '[]'");
  if (!names.has("feature")) db.exec("ALTER TABLE posts ADD COLUMN feature INTEGER NOT NULL DEFAULT 1");
  db.exec("UPDATE posts SET published_at = created_at WHERE status = 'published' AND published_at = 0");
  if (addedFlag) {
    const stored = db.prepare("SELECT value FROM kv WHERE key = 'config'").get() as { value?: string } | undefined;
    let mature = 0;
    let ai = 1;
    let noai = 0;
    try {
      const parsed = JSON.parse(stored?.value || "") as Partial<StudioConfig>;
      mature = parsed.publishMature === true ? 1 : 0;
      ai = parsed.publishAi === false ? 0 : 1;
      noai = parsed.publishNoai === true ? 1 : 0;
    } catch {
      // Keep the column defaults.
    }
    db.prepare("UPDATE posts SET mature = ?, ai = ?, noai = ?").run(mature, ai, noai);
  }
  db.prepare("UPDATE posts SET status = CASE WHEN itemid != '' THEN 'submitted' ELSE 'waiting' END, error = '' WHERE status = 'failed' AND (error LIKE '%refresh_token%' OR error LIKE '%no longer valid%')").run();
  db.prepare("UPDATE posts SET status = 'submitted' WHERE status = 'posting' AND itemid != ''").run();
  db.prepare("UPDATE posts SET status = 'waiting' WHERE status = 'posting'").run();
  const pendingTitles = db.prepare("SELECT id FROM posts WHERE status = 'titling' ORDER BY created_at ASC").all() as { id: string }[];
  for (const row of pendingTitles) queueTitle(row.id);
  return db;
}

function kvGet(key: string): string {
  const row = database().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? "";
}

function kvSet(key: string, value: string) {
  database().prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

function markWidthOf(value: unknown): number {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return 400;
  return Math.min(2000, Math.max(40, width));
}

function cornerOf(value: unknown): string {
  return value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right" ? value : "bottom-right";
}

function folderDefaultOf(value: unknown): string {
  if (value === "none" || value === "featured") return value;
  if (typeof value === "string" && /^[0-9a-f-]{16,40}$/i.test(value.trim())) return value.trim();
  return "featured";
}

function clampMinutes(value: unknown): number {
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return configDefaults.scheduleMinutes;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

function readConfig(): StudioConfig {
  try {
    const parsed = JSON.parse(kvGet("config") || "") as Partial<StudioConfig>;
    return {
      ...configDefaults,
      ...parsed,
      scheduleMinutes: clampMinutes(parsed.scheduleMinutes),
      visionEnabled: parsed.visionEnabled !== false,
      defaultFolder: folderDefaultOf(parsed.defaultFolder),
      watermarkCorner: cornerOf(parsed.watermarkCorner),
      watermarkWidth: markWidthOf(parsed.watermarkWidth),
      visionTemperature: temperatureOf(parsed.visionTemperature),
      visionTagCount: tagCountOf(parsed.visionTagCount),
    };
  } catch {
    return { ...configDefaults };
  }
}

function readSession(): StoredSession | null {
  try {
    const parsed = JSON.parse(kvGet("session") || "") as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function intervalMs(): number {
  return readConfig().scheduleMinutes * 60 * 1000;
}

function nextAt(): number {
  const value = Number(kvGet("nextAt") || 0);
  return Number.isFinite(value) ? value : 0;
}

function holdUntil(): number {
  const value = Number(kvGet("holdUntil") || 0);
  return Number.isFinite(value) ? value : 0;
}

export function startQueue(serverEnv: Record<string, string>) {
  env = serverEnv;
  if (serverGlobals.__deviantlabQueue) clearInterval(serverGlobals.__deviantlabQueue);
  void mkdir(FILES, { recursive: true }).then(() => mkdir(THUMBS, { recursive: true })).then(() => {
    database();
    serverGlobals.__deviantlabQueue = setInterval(() => void tick(), 5000);
  }).catch(() => undefined);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function listPosts(): PostRow[] {
  return database().prepare("SELECT id, name, status, title, tags, error, itemid, url, deviation_id, created_at, mature, ai, noai, watermark, studio, published_at, galleries, feature FROM posts ORDER BY sort ASC, created_at ASC").all() as PostRow[];
}

function publicPost(row: PostRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    title: row.title,
    tags: row.tags,
    error: row.error,
    itemid: row.itemid,
    url: row.url,
    deviationId: row.deviation_id,
    createdAt: row.created_at,
    mature: Number(row.mature) === 1,
    ai: Number(row.ai) !== 0,
    noai: Number(row.noai) === 1,
    watermark: Number(row.watermark) !== 0,
    studio: Number(row.studio) === 1,
    publishedAt: Number(row.published_at) || 0,
    galleries: parseGalleryIds(row.galleries),
    feature: Number(row.feature) !== 0,
  };
}

function snapshot() {
  const posts = listPosts().map(publicPost);
  return {
    posts,
    waiting: posts.filter((post) => post.status === "waiting" || post.status === "submitted" || post.status === "posting").length,
    nextAt: nextAt(),
    holdUntil: holdUntil(),
    holdReason: kvGet("holdReason"),
    paused: kvGet("paused") === "1",
    scheduleMinutes: readConfig().scheduleMinutes,
  };
}

function scheduleFirstWait() {
  const due = nextAt();
  if (due > Date.now()) return;
  kvSet("nextAt", String(Date.now() + intervalMs()));
}

function cleanName(value: string): string {
  const base = path.basename(decodeURIComponent(value || "upload")).replace(/[\u0000-\u001f]/g, "").trim();
  return (base || "upload").slice(0, 180);
}

function titledJpegName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return `${base || "upload"}.jpg`;
}

function cleanTags(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}]+/gu, "");
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 30);
}

function temperatureOf(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0.7;
  return Math.min(2, Math.max(0.01, Math.round(next * 100) / 100));
}

function tagCountOf(value: unknown): number {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return 25;
  return Math.min(30, Math.max(1, count));
}

async function saveThumb(id: string, bytes: Buffer) {
  try {
    const thumb = await sharp(bytes).rotate().resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    await writeFile(path.join(THUMBS, `${id}.jpg`), thumb);
  } catch {
    await rm(path.join(THUMBS, `${id}.jpg`), { force: true });
  }
}

async function addFile(name: string, bytes: Buffer, watermark: boolean, studio: boolean): Promise<string> {
  const id = crypto.randomUUID();
  await writeFile(path.join(FILES, id), bytes);
  await saveThumb(id, bytes);
  const config = readConfig();
  const placed = folderDefaultOf(config.defaultFolder);
  const galleryIds = parseGalleryIds([placed]);
  const now = Date.now();
  database().prepare(
    "INSERT INTO posts (id, name, status, title, tags, error, itemid, url, deviation_id, created_at, sort, mature, ai, noai, watermark, studio, galleries, feature) VALUES (?, ?, 'titling', '', '', '', '', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    name,
    now,
    now,
    config.publishMature ? 1 : 0,
    config.publishAi ? 1 : 0,
    config.publishNoai ? 1 : 0,
    watermark ? 1 : 0,
    studio ? 1 : 0,
    JSON.stringify(galleryIds),
    placed === "featured" ? 1 : 0,
  );
  queueTitle(id);
  return id;
}

let titleChain: Promise<void> = Promise.resolve();

const replaceTitles = new Set<string>();

function queueTitle(id: string, replace = false) {
  if (replace) replaceTitles.add(id);
  titleChain = titleChain.then(() => titleFile(id), () => titleFile(id));
}

async function titleFile(id: string) {
  const replace = replaceTitles.delete(id);
  const row = database().prepare("SELECT status FROM posts WHERE id = ?").get(id) as { status?: string } | undefined;
  if (!row || row.status !== "titling") return;
  if (!readConfig().visionEnabled) {
    database().prepare("UPDATE posts SET status = 'review', error = '' WHERE id = ? AND status = 'titling'").run(id);
    return;
  }
  try {
    const original = await readFile(path.join(FILES, id));
    const small = await sharp(original).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const config = readConfig();
    const named = await runVision({
      provider: config.visionProvider,
      model: config.visionModel,
      baseUrl: config.visionBaseUrl,
      apiKey: config.visionKey,
      imageBase64: small.toString("base64"),
      mediaType: "image/jpeg",
      temperature: config.visionTemperature,
      tagCount: config.visionTagCount,
    });
    const current = database().prepare("SELECT status, title, tags, studio FROM posts WHERE id = ?").get(id) as { status?: string; title?: string; tags?: string; studio?: number } | undefined;
    if (!current || current.status !== "titling") return;
    const keptTags = !replace && cleanTags(current.tags || "").length > 0 ? (current.tags || "") : named.tags.join(", ");
    const title = !replace && current.title?.trim() ? current.title.trim() : named.title;
    if (Number(current.studio) === 1) {
      database().prepare("UPDATE posts SET title = ?, tags = ?, error = '' WHERE id = ? AND status = 'titling'").run(title, keptTags, id);
      await submitStudio(id);
      return;
    }
    database().prepare("UPDATE posts SET status = 'review', title = ?, tags = ?, error = '' WHERE id = ?").run(title, keptTags, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not title this file.";
    database().prepare("UPDATE posts SET status = 'review', error = ? WHERE id = ? AND status = 'titling'").run(message, id);
  }
}

async function removePost(id: string) {
  const row = database().prepare("SELECT id, status FROM posts WHERE id = ?").get(id) as { id: string; status: string } | undefined;
  if (!row || row.status === "posting" || row.status === "published") return false;
  database().prepare("DELETE FROM posts WHERE id = ?").run(id);
  await rm(path.join(FILES, id), { force: true });
  await rm(path.join(THUMBS, `${id}.jpg`), { force: true });
  return true;
}

async function clearHistory(removeFiles: boolean) {
  const rows = database().prepare("SELECT id FROM posts WHERE status IN ('published', 'stashed')").all() as { id: string }[];
  database().prepare("DELETE FROM posts WHERE status IN ('published', 'stashed')").run();
  if (removeFiles) {
    for (const row of rows) {
      await rm(path.join(FILES, row.id), { force: true });
      await rm(path.join(THUMBS, `${row.id}.jpg`), { force: true });
    }
  }
  return rows.length;
}

function parseGalleryIds(value: unknown): string[] {
  const source = typeof value === "string" ? safeJson(value) : value;
  if (!Array.isArray(source)) return [];
  const ids: string[] = [];
  for (const item of source) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (/^[0-9a-f-]{16,40}$/i.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 20);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function patchPost(id: string, title: string, tags: string, flags: { mature: boolean; ai: boolean; noai: boolean; galleries?: string[]; feature?: boolean }) {
  const row = database().prepare("SELECT status FROM posts WHERE id = ?").get(id) as { status?: string } | undefined;
  if (!row || row.status === "published" || row.status === "posting" || row.status === "stashed") return false;
  database().prepare("UPDATE posts SET title = ?, tags = ?, mature = ?, ai = ?, noai = ?, galleries = ?, feature = ? WHERE id = ?").run(
    title.slice(0, 50),
    tags.slice(0, 2000),
    flags.mature ? 1 : 0,
    flags.ai ? 1 : 0,
    flags.noai ? 1 : 0,
    JSON.stringify(parseGalleryIds(flags.galleries ?? [])),
    flags.feature === false ? 0 : 1,
    id,
  );
  return true;
}

function retitlePost(id: string): string {
  const row = database().prepare("SELECT status FROM posts WHERE id = ?").get(id) as { status?: string } | undefined;
  if (!row || row.status !== "review") return "This file is not in Working.";
  const config = readConfig();
  const local = config.visionProvider === "lmstudio" || config.visionProvider === "comfyui";
  if (!config.visionEnabled || !config.visionModel.trim() || (!local && !config.visionKey.trim())) {
    return "Turn on Suggest titles and tags in Settings, and choose a model.";
  }
  database().prepare("UPDATE posts SET status = 'titling', title = '', tags = '', error = '' WHERE id = ? AND status = 'review'").run(id);
  queueTitle(id, true);
  return "";
}

function queuePost(id: string): boolean {
  const row = database().prepare("SELECT status, title, tags, studio FROM posts WHERE id = ?").get(id) as { status?: string; title?: string; tags?: string; studio?: number } | undefined;
  if (!row || row.status !== "review" || Number(row.studio) === 1) return false;
  if (!row.title?.trim() || cleanTags(row.tags || "").length === 0) return false;
  database().prepare(
    "UPDATE posts SET status = 'waiting', error = '', sort = (SELECT COALESCE(MAX(sort), 0) + 1 FROM posts WHERE status IN ('waiting', 'submitted', 'posting', 'failed')) WHERE id = ?",
  ).run(id);
  scheduleFirstWait();
  return true;
}

function reorderQueue(ids: string[]) {
  const rows = database().prepare(
    "SELECT id FROM posts WHERE status IN ('waiting', 'submitted', 'failed') ORDER BY sort ASC, created_at ASC",
  ).all() as { id: string }[];
  const allowed = new Set(rows.map((row) => row.id));
  const next = ids.filter((id) => allowed.has(id));
  for (const row of rows) {
    if (!next.includes(row.id)) next.push(row.id);
  }
  const update = database().prepare("UPDATE posts SET sort = ? WHERE id = ?");
  database().exec("BEGIN");
  try {
    database().prepare("UPDATE posts SET sort = 0 WHERE status = 'posting'").run();
    next.forEach((id, index) => update.run((index + 1) * 10, id));
    database().exec("COMMIT");
  } catch (error) {
    database().exec("ROLLBACK");
    throw error;
  }
}

function retryPost(id: string) {
  const row = database().prepare("SELECT status, itemid FROM posts WHERE id = ?").get(id) as { status?: string; itemid?: string } | undefined;
  if (!row || row.status !== "failed") return false;
  database().prepare("UPDATE posts SET status = ?, error = '' WHERE id = ?").run(row.itemid ? "submitted" : "waiting", id);
  kvSet("holdUntil", "0");
  kvSet("holdReason", "");
  kvSet("nextAt", String(Date.now()));
  return true;
}

function preservedVision(current: StudioConfig, body: Partial<StudioConfig>): Pick<StudioConfig, "visionProvider" | "visionModel" | "visionBaseUrl" | "visionKey"> {
  if (body.visionModel === undefined && body.visionProvider === undefined && body.visionBaseUrl === undefined && body.visionKey === undefined) {
    return {
      visionProvider: current.visionProvider,
      visionModel: current.visionModel,
      visionBaseUrl: current.visionBaseUrl,
      visionKey: current.visionKey,
    };
  }
  const model = (body.visionModel === undefined ? current.visionModel : body.visionModel).trim();
  if (!model && body.visionModel === undefined) {
    return {
      visionProvider: current.visionProvider,
      visionModel: current.visionModel,
      visionBaseUrl: body.visionBaseUrl === undefined ? current.visionBaseUrl : body.visionBaseUrl,
      visionKey: body.visionKey === undefined ? current.visionKey : body.visionKey,
    };
  }
  return {
    visionProvider: body.visionProvider === undefined ? current.visionProvider : body.visionProvider,
    visionModel: model,
    visionBaseUrl: body.visionBaseUrl === undefined ? current.visionBaseUrl : body.visionBaseUrl,
    visionKey: body.visionKey === undefined ? current.visionKey : body.visionKey,
  };
}

function retitleMissing() {
  const rows = database().prepare(
    "SELECT id FROM posts WHERE status = 'review' AND trim(title) = '' AND (error LIKE '%vision model%' OR error LIKE '%vision API key%') ORDER BY created_at ASC",
  ).all() as { id: string }[];
  for (const row of rows) {
    database().prepare("UPDATE posts SET status = 'titling', error = '' WHERE id = ?").run(row.id);
    queueTitle(row.id);
  }
}

async function saveConfig(body: Partial<StudioConfig> & { watermark?: string }) {
  const current = readConfig();
  const next: StudioConfig = {
    ...current,
    ...body,
    ...preservedVision(current, body),
    scheduleMinutes: body.scheduleMinutes === undefined ? current.scheduleMinutes : clampMinutes(body.scheduleMinutes),
    publishMature: body.publishMature === undefined ? current.publishMature : body.publishMature === true,
    publishAi: body.publishAi === undefined ? current.publishAi : body.publishAi !== false,
    publishNoai: body.publishNoai === undefined ? current.publishNoai : body.publishNoai === true,
    defaultFolder: body.defaultFolder === undefined ? current.defaultFolder : folderDefaultOf(body.defaultFolder),
    visionEnabled: body.visionEnabled === undefined ? current.visionEnabled : body.visionEnabled === true,
    watermarkCorner: body.watermarkCorner === undefined ? current.watermarkCorner : cornerOf(body.watermarkCorner),
    watermarkWidth: body.watermarkWidth === undefined ? current.watermarkWidth : markWidthOf(body.watermarkWidth),
    visionTemperature: temperatureOf(body.visionTemperature === undefined ? current.visionTemperature : body.visionTemperature),
    visionTagCount: tagCountOf(body.visionTagCount === undefined ? current.visionTagCount : body.visionTagCount),
  };
  kvSet("config", JSON.stringify(next));
  const localVision = next.visionProvider === "lmstudio" || next.visionProvider === "comfyui";
  const visionReady = next.visionEnabled && next.visionModel.trim() && (localVision || next.visionKey.trim());
  if (visionReady) retitleMissing();
  const due = nextAt();
  const cap = Date.now() + next.scheduleMinutes * 60 * 1000;
  if (due > cap) kvSet("nextAt", String(cap));
  if ("watermark" in body) {
    const value = body.watermark || "";
    if (!value) {
      await rm(MARK_PATH, { force: true });
    } else {
      const match = value.match(/^data:image\/png;base64,(.+)$/);
      if (match?.[1]) await writeFile(MARK_PATH, Buffer.from(match[1], "base64"));
    }
  }
}

function saveSession(body: StoredSession | null): "saved" | "kept" | "cleared" {
  if (!body?.accessToken || !body.refreshToken) {
    kvSet("session", "");
    return "cleared";
  }
  const previous = readSession();
  const incomingExpiry = Number(body.expiresAt) || 0;
  if (previous && previous.refreshToken !== body.refreshToken && previous.expiresAt >= incomingExpiry) return "kept";
  const replaced = !previous || previous.refreshToken !== body.refreshToken;
  kvSet("session", JSON.stringify({
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: incomingExpiry,
  }));
  if (!replaced) return "saved";
  database().prepare("UPDATE posts SET status = CASE WHEN itemid != '' THEN 'submitted' ELSE 'waiting' END, error = '' WHERE status = 'failed' AND error LIKE '%refresh_token%'").run();
  database().prepare("UPDATE posts SET error = '' WHERE status IN ('waiting', 'submitted') AND (error LIKE '%refresh_token%' OR error LIKE '%no longer valid%')").run();
  const reason = kvGet("holdReason");
  if (/queue is waiting/i.test(reason) && !/publish access/i.test(reason)) clearHold();
  return "saved";
}

const LOGIN_AGAIN = "Sign out and sign in again. This login is no longer valid.";
let refreshFlight: Promise<StoredSession> | null = null;

function invalidRefresh(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /refresh_token|invalid_grant|no longer valid/i.test(message);
}

async function exchangeRefresh(refreshToken: string): Promise<StoredSession> {
  const secret = env.DA_CLIENT_SECRET || DA_CLIENT_SECRET;
  const clientId = env.VITE_DA_CLIENT_ID || DA_CLIENT_ID;
  if (!secret || !clientId) throw new Error("DeviantArt app credentials are missing.");
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch("https://www.deviantart.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT },
    body: form,
  });
  const payload = (await response.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    const raw = payload.error_description || "";
    throw new Error(/refresh_token|invalid_grant/i.test(raw) ? LOGIN_AGAIN : raw || LOGIN_AGAIN);
  }
  const next = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  saveSession(next);
  return next;
}

export function refreshStoredSession(hint?: string): Promise<StoredSession> {
  const current = readSession();
  if (current && current.expiresAt > Date.now() + 60_000) return Promise.resolve(current);
  if (!refreshFlight) {
    refreshFlight = refreshOnce(hint).finally(() => {
      refreshFlight = null;
    });
  }
  return refreshFlight;
}

async function refreshOnce(hint?: string): Promise<StoredSession> {
  const current = readSession();
  if (current && current.expiresAt > Date.now() + 60_000) return current;
  if (current) {
    try {
      return await exchangeRefresh(current.refreshToken);
    } catch (error) {
      if (current.expiresAt > Date.now()) return current;
      if (!hint || hint === current.refreshToken || !invalidRefresh(error)) throw error;
    }
  }
  if (hint) return exchangeRefresh(hint);
  throw new Error(LOGIN_AGAIN);
}

async function refreshAccess(): Promise<string> {
  const session = await refreshStoredSession();
  return session.accessToken;
}

async function daFetch(pathname: string, token: string, body: FormData | URLSearchParams): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "user-agent": USER_AGENT,
    accept: "application/json",
    "dA-minor-version": "20240701",
  };
  if (body instanceof URLSearchParams) headers["content-type"] = "application/x-www-form-urlencoded";
  const response = await fetch(`https://www.deviantart.com/api/v1/oauth2${pathname}`, { method: "POST", headers, body });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const description = typeof payload.error_description === "string" ? payload.error_description : "";
    throw new Error(description || `DeviantArt returned ${response.status}.`);
  }
  return payload;
}

function holdFor(ms: number, reason: string) {
  kvSet("holdUntil", String(Date.now() + ms));
  kvSet("holdReason", reason);
}

function clearHold() {
  kvSet("holdUntil", "0");
  kvSet("holdReason", "");
}

function isLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /request limit|too many requests|429/i.test(message);
}

function isAuth(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /higher scope|re-authorize|reauthorize|insufficient|sign in again|refresh_token|invalid_grant|no longer valid/i.test(message);
}

async function prepareJpeg(bytes: Buffer, credit: string, applyMark: boolean, corner: string, maxMarkWidth: number): Promise<Buffer> {
  const meta = await sharp(bytes).rotate().metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  let pipeline = sharp(bytes).rotate();
  if (applyMark) {
    try {
      const mark = await readFile(MARK_PATH);
      const markWidth = Math.min(markWidthOf(maxMarkWidth), width);
      const resized = await sharp(mark).resize({ width: markWidth }).png().toBuffer();
      const markMeta = await sharp(resized).metadata();
      const placed = cornerOf(corner);
      const margin = 12;
      const markW = markMeta.width ?? 0;
      const markH = markMeta.height ?? 0;
      const left = placed.endsWith("right") ? Math.max(0, width - markW - margin) : Math.min(margin, Math.max(0, width - markW));
      const top = placed.startsWith("bottom") ? Math.max(0, height - markH - margin) : Math.min(margin, Math.max(0, height - markH));
      pipeline = pipeline.composite([{ input: resized, left, top }]);
    } catch {
      // No watermark file yet.
    }
  }
  const jpeg = await pipeline.jpeg({ quality: 95 }).toBuffer();
  return Buffer.from(jpegWithCredit(jpeg, credit));
}

async function submitStash(id: string, title: string, tags: string): Promise<string> {
  const config = readConfig();
  const token = await refreshAccess();
  const original = await readFile(path.join(FILES, id));
  const stored = database().prepare("SELECT watermark FROM posts WHERE id = ?").get(id) as { watermark?: number } | undefined;
  const jpeg = await prepareJpeg(original, config.credit, Number(stored?.watermark) !== 0, config.watermarkCorner, config.watermarkWidth);
  const form = new FormData();
  form.set("title", title);
  for (const tag of cleanTags(tags)) form.append("tags[]", tag);
  form.set("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), titledJpegName(title));
  const submitted = await daFetch("/stash/submit", token, form);
  if (submitted.itemid == null) throw new Error("DeviantArt did not accept the upload.");
  return String(submitted.itemid);
}

async function submitStudio(id: string): Promise<string> {
  const row = database().prepare("SELECT status, title, tags, itemid, studio FROM posts WHERE id = ?").get(id) as { status?: string; title?: string; tags?: string; itemid?: string; studio?: number } | undefined;
  if (!row || Number(row.studio) !== 1) return "That file is not a Studio upload.";
  if (row.status === "stashed" || row.status === "published" || row.status === "posting") return "";
  if (row.itemid) {
    database().prepare("UPDATE posts SET status = 'stashed', error = '' WHERE id = ?").run(id);
    return "";
  }
  const title = row.title?.trim() || "";
  if (!title || cleanTags(row.tags || "").length === 0) {
    const message = "Add a title and some tags first.";
    database().prepare("UPDATE posts SET status = 'review', error = ? WHERE id = ?").run(message, id);
    return message;
  }
  try {
    const itemid = await submitStash(id, title, row.tags || "");
    database().prepare("UPDATE posts SET status = 'stashed', itemid = ?, error = '' WHERE id = ?").run(itemid, id);
    await rm(path.join(FILES, id), { force: true });
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    database().prepare("UPDATE posts SET status = 'review', error = ? WHERE id = ?").run(message, id);
    if (isLimit(error)) holdFor(15 * 60 * 1000, "DeviantArt paused this account. The queue will try one post when the wait is over.");
    else if (isAuth(error) && /no longer valid|refresh_token|invalid_grant/i.test(message)) holdFor(60 * 60 * 1000, "Publishing stopped. This login expired.");
    return message;
  }
}

async function postOne(row: PostRow) {
  const token = await refreshAccess();
  let itemid = row.itemid;
  const title = row.title.trim();
  const tags = row.tags;
  if (!title || cleanTags(tags).length === 0) throw new Error("Add a title and tags before this joins the queue.");
  if (!itemid) {
    itemid = await submitStash(row.id, title, tags);
    database().prepare("UPDATE posts SET itemid = ?, status = 'submitted' WHERE id = ?").run(itemid, row.id);
  }
  const body = new URLSearchParams();
  body.set("itemid", itemid);
  const mature = Number(row.mature) === 1;
  body.set("is_mature", mature ? "true" : "false");
  if (mature) body.set("mature_level", "moderate");
  body.set("allow_comments", "true");
  body.set("is_ai_generated", Number(row.ai) !== 0 ? "true" : "false");
  body.set("noai", Number(row.noai) === 1 ? "true" : "false");
  for (const tag of cleanTags(tags)) body.append("tags[]", tag);
  const galleryIds = parseGalleryIds(row.galleries);
  for (const galleryId of galleryIds) body.append("galleryids[]", galleryId);
  body.set("feature", Number(row.feature) === 0 ? "false" : "true");
  const published = await daFetch("/stash/publish", token, body);
  const deviationId = typeof published.deviationid === "string" ? published.deviationid : "";
  if (!deviationId) throw new Error("Publish did not return a deviation.");
  const url = typeof published.url === "string" ? published.url : "";
  database().prepare("UPDATE posts SET status = 'published', url = ?, deviation_id = ?, error = '', title = ?, tags = ?, published_at = ? WHERE id = ?").run(url, deviationId, title, tags, Date.now(), row.id);
  await rm(path.join(FILES, row.id), { force: true });
  clearHold();
}

async function attempt(row: PostRow, schedule: boolean): Promise<string> {
  database().prepare("UPDATE posts SET status = 'posting', error = '' WHERE id = ?").run(row.id);
  try {
    await postOne(row);
    if (schedule) kvSet("nextAt", String(Date.now() + intervalMs()));
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    const current = database().prepare("SELECT itemid FROM posts WHERE id = ?").get(row.id) as { itemid?: string } | undefined;
    const status = current?.itemid ? "submitted" : "waiting";
    if (isLimit(error)) {
      database().prepare("UPDATE posts SET status = ?, error = ? WHERE id = ?").run(status, message, row.id);
      holdFor(15 * 60 * 1000, "DeviantArt paused this account. The queue will try one post when the wait is over.");
    } else if (isAuth(error)) {
      const deadLogin = /no longer valid|refresh_token|invalid_grant/i.test(message);
      if (deadLogin) {
        database().prepare("UPDATE posts SET status = ?, error = '' WHERE id = ?").run(status, row.id);
        holdFor(60 * 60 * 1000, "Publishing stopped. This login expired.");
      } else {
        database().prepare("UPDATE posts SET status = ?, error = ? WHERE id = ?").run(status, message, row.id);
        holdFor(24 * 60 * 60 * 1000, "Sign out and sign in again, then approve publish access. The queue is waiting.");
      }
    } else {
      database().prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(message, row.id);
      if (schedule) kvSet("nextAt", String(Date.now() + intervalMs()));
    }
    return message;
  }
}

async function tick() {
  if (serverGlobals.__deviantlabTicking) return;
  if (kvGet("paused") === "1") return;
  if (Date.now() < holdUntil()) return;
  if (Date.now() < nextAt()) return;
  const row = database().prepare(
    "SELECT id, name, status, title, tags, error, itemid, url, deviation_id, created_at, mature, ai, noai, galleries, feature FROM posts WHERE status IN ('waiting', 'submitted') ORDER BY sort ASC, created_at ASC LIMIT 1",
  ).get() as PostRow | undefined;
  if (!row) return;
  serverGlobals.__deviantlabTicking = true;
  try {
    await attempt(row, true);
  } finally {
    serverGlobals.__deviantlabTicking = false;
  }
}

async function publishNow(id: string): Promise<string> {
  if (serverGlobals.__deviantlabTicking) return "Already publishing a file.";
  if (Date.now() < holdUntil()) return kvGet("holdReason") || "The queue is waiting.";
  const row = database().prepare(
    "SELECT id, name, status, title, tags, error, itemid, url, deviation_id, created_at, mature, ai, noai, galleries, feature FROM posts WHERE id = ?",
  ).get(id) as PostRow | undefined;
  if (!row) return "missing";
  if (row.status !== "waiting" && row.status !== "submitted" && row.status !== "failed") return "That file is not waiting.";
  if (!row.title?.trim() || cleanTags(row.tags || "").length === 0) return "Add a title and tags first.";
  serverGlobals.__deviantlabTicking = true;
  try {
    return await attempt(row, false);
  } finally {
    serverGlobals.__deviantlabTicking = false;
  }
}

export async function handleQueue(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/da-queue")) return false;
  await mkdir(FILES, { recursive: true });
  await mkdir(THUMBS, { recursive: true });
  database();
  const method = (req.method || "GET").toUpperCase();
  const id = url.pathname.match(/^\/da-queue\/posts\/([^/]+)/)?.[1] || "";

  if (method === "GET" && url.pathname === "/da-queue") {
    sendJson(res, 200, snapshot());
    return true;
  }
  if (method === "GET" && id && url.pathname.endsWith("/thumb")) {
    try {
      const thumb = await readFile(path.join(THUMBS, `${id}.jpg`));
      res.statusCode = 200;
      res.setHeader("content-type", "image/jpeg");
      res.setHeader("cache-control", "no-store");
      res.end(thumb);
    } catch {
      sendJson(res, 404, { error: "missing" });
    }
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/files") {
    const bytes = await readRaw(req);
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      sendJson(res, 413, { error: "bad_file", error_description: "Use an image under 40MB." });
      return true;
    }
    const header = req.headers["x-filename"];
    const name = cleanName(typeof header === "string" ? header : "upload");
    const saved = await addFile(name, bytes, req.headers["x-watermark"] !== "0", req.headers["x-studio"] === "1");
    sendJson(res, 200, { id: saved });
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/settings") {
    const body = JSON.parse((await readRaw(req)).toString("utf8")) as Partial<StudioConfig> & { watermark?: string };
    await saveConfig(body);
    sendJson(res, 200, { ok: true, scheduleMinutes: readConfig().scheduleMinutes });
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/session") {
    const raw = (await readRaw(req)).toString("utf8");
    const body = raw ? JSON.parse(raw) as StoredSession | null : null;
    const result = saveSession(body);
    const stored = readSession();
    if (result === "saved" && stored && stored.expiresAt > Date.now() + 60_000 && /sign in again|publish access|queue is waiting|login expired/i.test(kvGet("holdReason"))) {
      kvSet("holdUntil", "0");
      kvSet("holdReason", "");
      kvSet("nextAt", String(Date.now()));
    }
    sendJson(res, 200, { ok: true, kept: result === "kept", expiresAt: stored?.expiresAt || 0 });
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/pause") {
    const raw = (await readRaw(req)).toString("utf8");
    const body = raw ? JSON.parse(raw) as { paused?: unknown } : {};
    kvSet("paused", body.paused === true ? "1" : "0");
    sendJson(res, 200, snapshot());
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/history") {
    const raw = (await readRaw(req)).toString("utf8");
    const body = raw ? JSON.parse(raw) as { files?: unknown } : {};
    const cleared = await clearHistory(body.files === true);
    sendJson(res, 200, { cleared });
    return true;
  }
  if (method === "POST" && url.pathname === "/da-queue/order") {
    const body = JSON.parse((await readRaw(req)).toString("utf8")) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === "string") : [];
    reorderQueue(ids);
    sendJson(res, 200, snapshot());
    return true;
  }
  if (method === "PATCH" && id && url.pathname === `/da-queue/posts/${id}`) {
    const body = JSON.parse((await readRaw(req)).toString("utf8")) as { title?: unknown; tags?: unknown; mature?: unknown; ai?: unknown; noai?: unknown; galleries?: unknown; feature?: unknown };
    const ok = patchPost(
      id,
      typeof body.title === "string" ? body.title : "",
      typeof body.tags === "string" ? body.tags : "",
      { mature: body.mature === true, ai: body.ai !== false, noai: body.noai === true, galleries: parseGalleryIds(body.galleries), feature: body.feature !== false },
    );
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "missing" });
    return true;
  }
  if (method === "DELETE" && id && url.pathname === `/da-queue/posts/${id}`) {
    const ok = await removePost(id);
    sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "missing" });
    return true;
  }
  if (method === "POST" && id && url.pathname === `/da-queue/posts/${id}/studio`) {
    const message = await submitStudio(id);
    if (!message) {
      sendJson(res, 200, snapshot());
      return true;
    }
    sendJson(res, 400, { error: "studio", error_description: message });
    return true;
  }
  if (method === "POST" && id && url.pathname === `/da-queue/posts/${id}/retitle`) {
    const message = retitlePost(id);
    if (!message) {
      sendJson(res, 200, snapshot());
      return true;
    }
    sendJson(res, 400, { error: "retitle", error_description: message });
    return true;
  }
  if (method === "POST" && id && url.pathname === `/da-queue/posts/${id}/queue`) {
    const ok = queuePost(id);
    sendJson(res, ok ? 200 : 400, ok ? snapshot() : { error: "needs_review", error_description: "Save a title and some tags, then add it to the queue." });
    return true;
  }
  if (method === "POST" && id && url.pathname === `/da-queue/posts/${id}/now`) {
    const message = await publishNow(id);
    if (!message) {
      sendJson(res, 200, snapshot());
      return true;
    }
    sendJson(res, message === "missing" ? 404 : 400, { error: "publish", error_description: message === "missing" ? "That file is not in the queue." : message });
    return true;
  }
  if (method === "POST" && id && url.pathname === `/da-queue/posts/${id}/retry`) {
    const ok = retryPost(id);
    sendJson(res, ok ? 200 : 404, ok ? snapshot() : { error: "missing" });
    return true;
  }
  sendJson(res, 404, { error: "missing" });
  return true;
}
