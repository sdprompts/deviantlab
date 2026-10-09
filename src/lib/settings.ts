import { syncStudioConfig, syncStudioWatermark } from "./studio/queueClient";

export type VisionProvider = "openrouter" | "lmstudio" | "openai" | "claude" | "grok" | "gemini" | "comfyui";
export type WatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type AppSettings = {
  scheduleMinutes: number;
  credit: string;
  visionEnabled: boolean;
  visionProvider: VisionProvider;
  visionModel: string;
  visionModels: Partial<Record<VisionProvider, string>>;
  visionBaseUrl: string;
  visionKey: string;
  visionTemperature: number;
  visionTagCount: number;
  visionPrompt: string;
  defaultTags: string;
  publishMature: boolean;
  publishAi: boolean;
  publishNoai: boolean;
  defaultFolder: string;
  displayResolution: number;
  watermarkCorner: WatermarkCorner;
  watermarkWidth: number;
};

const KEY = "da.settings";
const MARK_KEY = "da.watermark";
const listeners = new Set<() => void>();

const defaults: AppSettings = {
  scheduleMinutes: 30,
  credit: "",
  visionEnabled: true,
  visionProvider: "openrouter",
  visionModel: "",
  visionModels: {},
  visionBaseUrl: "",
  visionKey: "",
  visionTemperature: 0.7,
  visionTagCount: 25,
  visionPrompt: "",
  defaultTags: "",
  publishMature: false,
  publishAi: true,
  publishNoai: false,
  defaultFolder: "featured",
  displayResolution: 0,
  watermarkCorner: "bottom-right",
  watermarkWidth: 400,
};

function notify() {
  for (const listener of listeners) listener();
}

export function readSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "") as Partial<AppSettings>;
    const minutes = Math.round(Number(parsed.scheduleMinutes));
    const visionProvider = isProvider(parsed.visionProvider) ? parsed.visionProvider : "openrouter";
    const visionModels = modelsFor(parsed.visionModels, visionProvider, typeof parsed.visionModel === "string" ? parsed.visionModel : "");
    return {
      ...defaults,
      ...parsed,
      scheduleMinutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(5, minutes)) : 30,
      publishMature: parsed.publishMature === true,
      publishAi: parsed.publishAi !== false,
      publishNoai: parsed.publishNoai === true,
      defaultFolder: folderDefaultOf(parsed.defaultFolder),
      displayResolution: displayResolutionOf(parsed.displayResolution),
      visionEnabled: parsed.visionEnabled !== false,
      visionProvider,
      visionModel: visionModels[visionProvider] || "",
      visionModels,
      watermarkCorner: isCorner(parsed.watermarkCorner) ? parsed.watermarkCorner : "bottom-right",
      watermarkWidth: markWidthOf(parsed.watermarkWidth),
      visionTemperature: temperatureOf(parsed.visionTemperature),
      visionTagCount: tagCountOf(parsed.visionTagCount),
      visionPrompt: promptOf(parsed.visionPrompt),
      defaultTags: defaultTagsOf(parsed.defaultTags),
    };
  } catch {
    return { ...defaults };
  }
}

function modelsFor(value: unknown, provider: VisionProvider, model: string): Partial<Record<VisionProvider, string>> {
  const stored: Partial<Record<VisionProvider, string>> = {};
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!isProvider(key)) continue;
      const remembered = rememberedModel(key, item);
      if (remembered) stored[key] = remembered;
    }
  }
  const current = rememberedModel(provider, model);
  if (current) stored[provider] = current;
  return withoutBorrowedClip(stored);
}

function rememberedModel(provider: VisionProvider, model: unknown): string {
  if (typeof model !== "string") return "";
  const value = model.trim();
  if (!value) return "";
  if (provider !== "comfyui" && /\.(safetensors|ckpt|pt|pth|onnx)$/i.test(value)) return "";
  return value;
}

function withoutBorrowedClip(models: Partial<Record<VisionProvider, string>>): Partial<Record<VisionProvider, string>> {
  const clip = models.comfyui;
  if (!clip) return models;
  const next = { ...models };
  for (const key of Object.keys(next) as VisionProvider[]) {
    if (key !== "comfyui" && next[key] === clip) delete next[key];
  }
  return next;
}

export function visionForProvider(settings: AppSettings, next: VisionProvider): Pick<AppSettings, "visionProvider" | "visionModel" | "visionModels"> {
  const visionModels = withoutBorrowedClip({
    ...settings.visionModels,
    [settings.visionProvider]: rememberedModel(settings.visionProvider, settings.visionModel),
  });
  if (!visionModels[settings.visionProvider]) delete visionModels[settings.visionProvider];
  const visionModel = rememberedModel(next, visionModels[next]);
  if (visionModel) visionModels[next] = visionModel;
  else delete visionModels[next];
  return { visionProvider: next, visionModel, visionModels };
}

function isProvider(value: unknown): value is VisionProvider {
  return value === "openrouter" || value === "lmstudio" || value === "openai" || value === "claude" || value === "grok" || value === "gemini" || value === "comfyui";
}

function isCorner(value: unknown): value is WatermarkCorner {
  return value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right";
}

export function folderDefaultOf(value: unknown): string {
  if (value === "none" || value === "featured") return value;
  if (typeof value === "string" && /^[0-9a-f-]{16,40}$/i.test(value.trim())) return value.trim();
  return "featured";
}

export function temperatureOf(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0.7;
  return Math.min(2, Math.max(0.01, Math.round(next * 100) / 100));
}

export function tagCountOf(value: unknown): number {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return 25;
  return Math.min(30, Math.max(1, count));
}

export const defaultVisionPrompt = "The title is a gallery artwork title: evocative, specific, and a little unexpected, a name for the mood, the stakes, or the moment. Metaphor is welcome when it fits the picture. Do not list the objects, and do not write a caption. 3 to 8 words, at most 50 characters, with no quotation marks. Each tag is one plain word. Name the main subject with the ordinary word, then the place, then the few objects that define the picture. Skip background clutter. Add a few style words when they fit, such as portrait or cinematic, art style words when they fit, such as realism or painting, and a period word when it fits, joined into one word, such as ancientegypt. Do not name colours. Do not add mood or abstract words. Do not invent tags to fill the list. No # and no sentences.";

export function promptOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return defaultVisionPrompt;
  return value.trim().slice(0, 4000);
}

export function defaultTagsOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}]+/gu, "");
    const key = tag.toLowerCase();
    if (!tag || tag.length > 40 || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 30) break;
  }
  return tags.join(", ");
}

export const displayWidths = [0, 400, 600, 800, 900, 1024, 1280, 1600, 1920] as const;

export function displayResolutionOf(value: unknown): number {
  const index = Math.round(Number(value));
  if (!Number.isInteger(index) || index < 0 || index >= displayWidths.length) return 0;
  return index;
}

export function markWidthOf(value: unknown): number {
  const width = Math.round(Number(value));
  if (!Number.isFinite(width)) return 400;
  return Math.min(2000, Math.max(40, width));
}

export function updateSettings(patch: Partial<AppSettings>) {
  const next = { ...readSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  notify();
  syncStudioConfig(next, true);
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readWatermark(): string {
  return localStorage.getItem(MARK_KEY) || "";
}

export function saveWatermark(dataUrl: string) {
  localStorage.setItem(MARK_KEY, dataUrl);
  notify();
  syncStudioWatermark(dataUrl);
}

export function clearWatermark() {
  localStorage.removeItem(MARK_KEY);
  notify();
  syncStudioWatermark("");
}
