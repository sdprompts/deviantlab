import { apiGet } from "./api";

export type GalleryFolder = {
  id: string;
  name: string;
  parent: string;
};

type FolderPayload = {
  results?: { folderid?: string; name?: string; parent?: string | null }[];
  has_more?: boolean;
  next_offset?: number | null;
};

let cacheKey = "";
let cache: GalleryFolder[] | null = null;

export async function loadGalleryFolders(username: string): Promise<GalleryFolder[]> {
  if (cache && cacheKey === username) return cache;
  const folders: GalleryFolder[] = [];
  let offset = 0;
  for (let page = 0; page < 8; page += 1) {
    const payload = await apiGet<FolderPayload>(`/gallery/folders?limit=50&offset=${offset}&calculate_size=false`);
    for (const folder of payload.results ?? []) {
      const id = (folder.folderid || "").trim();
      const name = (folder.name || "").trim();
      if (!id || !name) continue;
      folders.push({ id, name, parent: (folder.parent || "").trim() });
    }
    if (!payload.has_more || payload.next_offset == null) break;
    offset = payload.next_offset;
  }
  cacheKey = username;
  cache = folders;
  return folders;
}

export function folderLabel(folder: GalleryFolder, folders: GalleryFolder[]): string {
  const parent = folders.find((item) => item.id === folder.parent);
  if (!parent || isBuiltInFeatured(parent)) return folder.name;
  return `${parent.name} / ${folder.name}`;
}

export function isBuiltInFeatured(folder: GalleryFolder): boolean {
  return !folder.parent && folder.name.toLowerCase() === "featured";
}
