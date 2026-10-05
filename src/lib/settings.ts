import { syncStudioConfig, syncStudioWatermark } from "./studio/queueClient";

export type VisionProvider = "openrouter" | "lmstudio" | "openai" | "claude" | "grok" | "gemini";
export type WatermarkCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type AppSettings = {
  scheduleMinutes: number;
  credit: string;
  visionEnabled: boolean;
  visionProvider: VisionProvider;
  visionModel: string;
  visionBaseUrl: string;
  visionKey: string;
  publishMature: boolean;
  publishAi: boolean;
  publishNoai: boolean;
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
  visionBaseUrl: "",
  visionKey: "",
  publishMature: false,
  publishAi: true,
  publishNoai: false,
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
    return {
      ...defaults,
      ...parsed,
      scheduleMinutes: Number.isFinite(minutes) ? Math.min(1440, Math.max(5, minutes)) : 30,
      publishMature: parsed.publishMature === true,
      publishAi: parsed.publishAi !== false,
      publishNoai: parsed.publishNoai === true,
      visionEnabled: parsed.visionEnabled !== false,
      visionProvider: isProvider(parsed.visionProvider) ? parsed.visionProvider : "openrouter",
      watermarkCorner: isCorner(parsed.watermarkCorner) ? parsed.watermarkCorner : "bottom-right",
      watermarkWidth: markWidthOf(parsed.watermarkWidth),
    };
  } catch {
    return { ...defaults };
  }
}

function isProvider(value: unknown): value is VisionProvider {
  return value === "openrouter" || value === "lmstudio" || value === "openai" || value === "claude" || value === "grok" || value === "gemini";
}

function isCorner(value: unknown): value is WatermarkCorner {
  return value === "top-left" || value === "top-right" || value === "bottom-left" || value === "bottom-right";
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
  syncStudioConfig(next);
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
