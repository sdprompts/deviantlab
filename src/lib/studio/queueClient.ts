import type { AppSettings } from "../settings";
import type { Session } from "../auth/session";
import { restoreSession } from "../da/api";

export type QueuePost = {
  id: string;
  name: string;
  status: "titling" | "review" | "waiting" | "submitted" | "posting" | "published" | "stashed" | "failed";
  title: string;
  tags: string;
  error: string;
  itemid: string;
  url: string;
  deviationId: string;
  createdAt: number;
  mature: boolean;
  ai: boolean;
  noai: boolean;
  watermark: boolean;
  studio: boolean;
  publishedAt: number;
  galleries: string[];
  feature: boolean;
};

export type QueueSnapshot = {
  posts: QueuePost[];
  waiting: number;
  nextAt: number;
  holdUntil: number;
  holdReason: string;
  paused: boolean;
  scheduleMinutes: number;
};

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Record<string, unknown> = {};

function sendConfig(body: Record<string, unknown>) {
  pending = { ...pending, ...body };
  clearTimeout(timer);
  timer = setTimeout(() => {
    const next = pending;
    pending = {};
    void fetch("/da-queue/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => undefined);
  }, 400);
}

export function syncStudioConfig(settings: AppSettings, includeVision = false) {
  const body: Record<string, unknown> = {
    scheduleMinutes: settings.scheduleMinutes,
    credit: settings.credit,
    publishMature: settings.publishMature,
    publishAi: settings.publishAi,
    publishNoai: settings.publishNoai,
    defaultFolder: settings.defaultFolder,
    visionEnabled: settings.visionEnabled,
    visionTemperature: settings.visionTemperature,
    watermarkCorner: settings.watermarkCorner,
    watermarkWidth: settings.watermarkWidth,
  };
  if (includeVision || settings.visionModel.trim()) {
    body.visionProvider = settings.visionProvider;
    body.visionModel = settings.visionModel;
    body.visionBaseUrl = settings.visionBaseUrl;
    body.visionKey = settings.visionKey;
  }
  sendConfig(body);
}

export function syncStudioWatermark(watermark: string) {
  sendConfig({ watermark });
}

export function syncStudioSession(session: Session | null) {
  void fetch("/da-queue/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session ? {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    } : null),
  }).then(async (response) => {
    if (!session || !response.ok) return;
    const payload = (await response.json()) as { kept?: boolean; expiresAt?: number };
    if (payload.kept && payload.expiresAt && payload.expiresAt > session.expiresAt && payload.expiresAt > Date.now() + 60_000) {
      await restoreSession();
    }
  }).catch(() => undefined);
}

export async function fetchQueue(): Promise<QueueSnapshot> {
  const response = await fetch("/da-queue");
  if (!response.ok) throw new Error("Could not load the publish queue.");
  return response.json() as Promise<QueueSnapshot>;
}

export async function enqueueStudioFile(file: File, watermark = true, studio = false): Promise<void> {
  const response = await fetch("/da-queue/files", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-filename": encodeURIComponent(file.name),
      "x-watermark": watermark ? "1" : "0",
      "x-studio": studio ? "1" : "0",
    },
    body: file,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string } | null;
    throw new Error(payload?.error_description || "Could not add that file.");
  }
}

export async function updateQueuedPost(id: string, title: string, tags: string, flags: { mature: boolean; ai: boolean; noai: boolean; galleries: string[]; feature: boolean }): Promise<void> {
  await fetch(`/da-queue/posts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, tags, ...flags }),
  });
}

export async function removeQueuedPost(id: string): Promise<void> {
  await fetch(`/da-queue/posts/${id}`, { method: "DELETE" });
}

export async function submitToStudio(id: string): Promise<void> {
  const response = await fetch(`/da-queue/posts/${id}/studio`, { method: "POST" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string } | null;
    throw new Error(payload?.error_description || "Could not upload that file.");
  }
}

export async function retitleQueuedPost(id: string): Promise<void> {
  const response = await fetch(`/da-queue/posts/${id}/retitle`, { method: "POST" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string } | null;
    throw new Error(payload?.error_description || "Could not regenerate the title.");
  }
}

export async function approveQueuedPost(id: string): Promise<void> {
  const response = await fetch(`/da-queue/posts/${id}/queue`, { method: "POST" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string } | null;
    throw new Error(payload?.error_description || "Save a title and some tags first.");
  }
}

export async function setQueuePaused(paused: boolean): Promise<void> {
  await fetch("/da-queue/pause", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paused }),
  });
}

export async function reorderQueue(ids: string[]): Promise<void> {
  await fetch("/da-queue/order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export async function publishQueuedNow(id: string): Promise<void> {
  const response = await fetch(`/da-queue/posts/${id}/now`, { method: "POST" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error_description?: string } | null;
    throw new Error(payload?.error_description || "Could not publish that file.");
  }
}

export async function retryQueuedPost(id: string): Promise<void> {
  await fetch(`/da-queue/posts/${id}/retry`, { method: "POST" });
}

export async function clearQueueHistory(removeFiles: boolean): Promise<void> {
  const response = await fetch("/da-queue/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: removeFiles }),
  });
  if (!response.ok) throw new Error("Could not clear that history.");
}
