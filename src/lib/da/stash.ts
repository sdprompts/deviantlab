import { DaError, apiPost } from "./api";

export type LocalStashItem = {
  itemid: string;
  title: string;
  tags: string[];
  thumb: string;
  url?: string;
  deviationId?: string;
};

const LOCAL_KEY = "da.studio.local";

function cleanTag(tag: string): string {
  return tag.trim().replace(/^#/, "").replace(/[\s_]+/g, "");
}

export function stashTags(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,\n]/)) {
    const tag = cleanTag(part);
    if (tag && /^[\p{L}\p{N}_-]+$/u.test(tag)) seen.add(tag);
  }
  return [...seen].slice(0, 30);
}

function tagFields(tags: string[]): URLSearchParams {
  const body = new URLSearchParams();
  for (const tag of tags) body.append("tags[]", tag);
  return body;
}

export function localStash(): LocalStashItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "") as LocalStashItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearLocalStash() {
  localStorage.removeItem(LOCAL_KEY);
}

export function rememberStash(item: LocalStashItem) {
  const next = [item, ...localStash().filter((row) => row.itemid !== item.itemid)].slice(0, 80);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}

export function updateLocalStash(itemid: string, patch: Partial<LocalStashItem>) {
  const next = localStash().map((row) => (row.itemid === itemid ? { ...row, ...patch } : row));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}

export async function submitStash(file: Blob, title: string, tags: string[]): Promise<string> {
  const body = new FormData();
  if (title) body.set("title", title);
  for (const tag of tags) body.append("tags[]", tag);
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 120);
  body.set("file", file, `${base || "upload"}.jpg`);
  const payload = await apiPost<{ status?: string; itemid?: number | string }>("/stash/submit", { file: body });
  if (payload.itemid == null) throw new DaError("Sta.sh did not return an item id.");
  return String(payload.itemid);
}

export async function publishStash(options: {
  itemid: string;
  tags: string[];
  mature: boolean;
  aiGenerated: boolean;
  noai: boolean;
}): Promise<{ url: string; deviationId: string }> {
  const body = tagFields(options.tags);
  body.set("itemid", options.itemid);
  body.set("is_mature", options.mature ? "true" : "false");
  if (options.mature) body.set("mature_level", "moderate");
  body.set("allow_comments", "true");
  body.set("is_ai_generated", options.aiGenerated ? "true" : "false");
  body.set("noai", options.noai ? "true" : "false");
  const payload = await apiPost<{ url?: string; deviationid?: string }>("/stash/publish", { form: body });
  if (!payload.deviationid) throw new DaError("Publish did not return a deviation.");
  return { url: payload.url || "", deviationId: payload.deviationid };
}

export async function editPublishedTags(deviationId: string, tags: string[]): Promise<void> {
  const body = tagFields(tags);
  await apiPost(`/deviation/edit/${encodeURIComponent(deviationId)}`, { form: body });
}
