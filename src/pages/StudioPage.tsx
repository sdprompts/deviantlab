import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../components/PageHeader";
import { useLab } from "../lab";
import {
  editPublishedTags,
  localStash,
  publishStash,
  stashTags,
  updateLocalStash,
  type LocalStashItem,
} from "../lib/da/stash";
import { folderLabel, loadGalleryFolders, type GalleryFolder } from "../lib/da/folders";
import { acceptedFile } from "../lib/studio/preprocess";
import {
  approveQueuedPost,
  enqueueStudioFile,
  fetchQueue,
  removeQueuedPost,
  reorderQueue,
  publishQueuedNow,
  retryQueuedPost,
  setQueuePaused,
  submitToStudio,
  updateQueuedPost,
  type QueuePost,
  type QueueSnapshot,
} from "../lib/studio/queueClient";
import { readSettings } from "../lib/settings";

type StudioTab = "working" | "studio" | "queued" | "published";
type QueueView = "cards" | "thumbs";

const studioTabs: { id: StudioTab; label: string }[] = [
  { id: "working", label: "Working" },
  { id: "studio", label: "Sent to Stash" },
  { id: "queued", label: "Queued" },
  { id: "published", label: "Published" },
];

function span(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const hourRest = hours % 24;
  return hourRest ? `${days} days ${hourRest} hr` : `${days} days`;
}

function queueLine(snapshot: QueueSnapshot | null): string {
  if (!snapshot) return "Loading the queue.";
  if (snapshot.holdReason && snapshot.holdUntil > Date.now() && snapshot.holdReason !== "Sign out and sign in again. The queue is waiting.") return snapshot.holdReason;
  if (snapshot.paused) return snapshot.waiting === 0 ? "Paused." : `${snapshot.waiting} waiting. Paused.`;
  if (snapshot.waiting === 0) return "";
  const posting = snapshot.posts.some((post) => post.status === "posting");
  const waitMs = Math.max(0, snapshot.nextAt - Date.now());
  const minutes = Math.ceil(waitMs / 60000);
  const next = posting ? "Publishing." : minutes <= 0 ? "Next post is due." : `Next post in about ${minutes} min.`;
  const head = `${snapshot.waiting} waiting. ${next}`;
  if (snapshot.waiting < 2) return head;
  const gap = Math.max(1, snapshot.scheduleMinutes) * 60 * 1000;
  return `${head} All published in about ${span(waitMs + (snapshot.waiting - 1) * gap)}.`;
}

function shuffleIds(ids: string[]): string[] {
  const next = [...ids];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = next[index];
    next[index] = next[swap];
    next[swap] = current;
  }
  return next;
}

function orderedQueued(posts: QueuePost[], order: string[] | null): QueuePost[] {
  const byId = new Map(posts.map((post) => [post.id, post]));
  const ids = (order ?? posts.map((post) => post.id)).filter((id) => byId.has(id));
  for (const post of posts) {
    if (!ids.includes(post.id)) ids.push(post.id);
  }
  const list = ids.map((id) => byId.get(id)!);
  return [...list.filter((post) => post.status === "posting"), ...list.filter((post) => post.status !== "posting")];
}

export function StudioPage() {
  const { session, signIn } = useLab();
  const [saved, setSaved] = useState<LocalStashItem[]>(() => localStash());
  const [notice, setNotice] = useState("");
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<StudioTab>("working");
  const [dragId, setDragId] = useState("");
  const [queueView, setQueueView] = useState<QueueView>("cards");
  const [queueOrder, setQueueOrder] = useState<string[] | null>(null);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [folderNote, setFolderNote] = useState("");
  const [destination, setDestination] = useState<"publish" | "stash">("publish");
  const [alreadyMarked, setAlreadyMarked] = useState(false);
  const queueOrderRef = useRef<string[] | null>(null);

  async function reload() {
    try {
      setQueue(await fetchQueue());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load the publish queue.");
    }
  }

  useEffect(() => {
    if (!session) return;
    void reload();
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    setFolderNote("Loading folders…");
    loadGalleryFolders(session.username)
      .then((list) => {
        if (stop) return;
        setFolders(list);
        setFolderNote(list.length === 0 ? "No gallery folders on this account." : "");
      })
      .catch((err: unknown) => {
        if (stop) return;
        setFolders([]);
        const message = err instanceof Error ? err.message : "Could not load gallery folders.";
        setFolderNote(/scope|browse|insufficient/i.test(message) ? "Sign in again to load gallery folders." : message);
      });
    return () => {
      stop = true;
    };
  }, [session]);

  async function ingest(list: File[], watermark = true, studio = false) {
    const files = list.filter(acceptedFile);
    if (files.length === 0) {
      setNotice("Use png, jpg, jpeg, bmp, or gif.");
      return;
    }
    setAdding(true);
    setNotice("");
    try {
      for (const file of files) await enqueueStudioFile(file, watermark, studio);
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add that file.");
    } finally {
      setAdding(false);
    }
  }

  if (!session) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader kicker="Uploads" title="Uploads" />
        <div className="flex flex-1 flex-col justify-center px-8">
          <p className="max-w-sm text-sm leading-relaxed text-zinc-400">Sign in to queue uploads.</p>
          <button type="button" onClick={signIn} className="mt-4 h-9 w-fit rounded-md bg-da px-4 text-[13px] font-semibold text-black hover:bg-[#3ad866]">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const posts = queue?.posts ?? [];
  const working = posts.filter((post) => post.status === "titling" || post.status === "review");
  const studioPosts = posts.filter((post) => post.status === "stashed").sort((a, b) => b.createdAt - a.createdAt);
  const queued = posts.filter((post) => post.status === "waiting" || post.status === "submitted" || post.status === "posting" || post.status === "failed");
  const published = posts.filter((post) => post.status === "published").sort((a, b) => (b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt));
  const counts: Record<StudioTab, number> = {
    working: working.length,
    studio: studioPosts.length,
    queued: queued.length,
    published: published.length,
  };
  const shown = tab === "working" ? working : tab === "studio" ? studioPosts : tab === "published" ? published : orderedQueued(queued, queueOrder);
  const status = notice || (adding ? "Adding files…" : tab === "queued" ? queueLine(queue) : "");

  function moveQueued(overId: string) {
    if (!dragId || dragId === overId) return;
    const over = queued.find((post) => post.id === overId);
    if (!over || over.status === "posting") return;
    const current = queueOrderRef.current ?? queued.map((post) => post.id);
    const next = current.filter((id) => id !== dragId);
    const index = next.indexOf(overId);
    if (index < 0) return;
    next.splice(index, 0, dragId);
    queueOrderRef.current = next;
    setQueueOrder([...next]);
  }

  async function finishDrag() {
    const ids = (queueOrderRef.current ?? []).filter((id) => queued.some((post) => post.id === id && post.status !== "posting"));
    setDragId("");
    queueOrderRef.current = null;
    setQueueOrder(null);
    if (ids.length > 1) await reorderQueue(ids);
    await reload();
  }

  async function shuffleQueued() {
    const ids = shuffleIds(queued.filter((post) => post.status !== "posting").map((post) => post.id));
    if (ids.length < 2) return;
    await reorderQueue(ids);
    await reload();
  }

  async function togglePause() {
    await setQueuePaused(!queue?.paused);
    await reload();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader kicker="Uploads" title="Uploads">
        <div className="flex rounded-full bg-white/[0.04] p-0.5">
          {studioTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                tab === item.id ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {item.label}
              <span className={`ml-1.5 tabular-nums ${tab === item.id ? "text-black/50" : "text-zinc-500"}`}>{counts[item.id]}</span>
            </button>
          ))}
        </div>
        {tab === "queued" ? (
          <div className="flex rounded-full bg-white/[0.04] p-0.5">
            {(["cards", "thumbs"] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={queueView === view}
                onClick={() => setQueueView(view)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium ${queueView === view ? "bg-white text-black" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {view === "cards" ? "Cards" : "Thumbs"}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "queued" ? (
          <button
            type="button"
            onClick={() => void togglePause()}
            className={`flex h-7 shrink-0 items-center rounded-md border px-3 text-[12px] ${queue?.paused ? "border-da bg-da font-semibold text-black" : "border-lab-line text-zinc-300 hover:border-zinc-500"}`}
          >
            {queue?.paused ? "Resume" : "Pause"}
          </button>
        ) : null}
        {tab === "queued" && queued.filter((post) => post.status !== "posting").length > 1 ? (
          <button
            type="button"
            onClick={() => void shuffleQueued()}
            className="flex h-7 shrink-0 items-center rounded-md border border-lab-line px-3 text-[12px] text-zinc-300 hover:border-zinc-500"
          >
            Shuffle
          </button>
        ) : null}
      </PageHeader>
      {status ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-lab-line px-4 py-2">
          <p className="text-[13px] text-zinc-300">{status}</p>
          {queue && queue.holdUntil > Date.now() && /login expired/i.test(queue.holdReason) ? (
            <button type="button" onClick={signIn} className="h-7 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866]">
              Sign in
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 px-4 py-4 ${shown.length === 0 && (tab === "working" || tab === "studio") ? "flex flex-col" : "overflow-y-auto"}`}>
        {folderNote ? (
          <p className="mb-3 flex items-center gap-3 text-[13px] text-zinc-400">
            <span>{folderNote}</span>
            {folderNote === "Sign in again to load gallery folders." ? (
              <button type="button" onClick={signIn} className="h-7 rounded-md bg-da px-2.5 text-[12px] font-semibold text-black hover:bg-[#3ad866]">
                Sign in
              </button>
            ) : null}
          </p>
        ) : null}
        <UploadBox
          fill={shown.length === 0 && (tab === "working" || tab === "studio")}
          destination={destination}
          alreadyMarked={alreadyMarked}
          onDestination={setDestination}
          onAlreadyMarked={setAlreadyMarked}
          onFiles={(files) => void ingest(files, !alreadyMarked, destination === "stash")}
        />
        {shown.length === 0 ? (
          tab === "queued" || tab === "published" ? (
            <p className="text-[13px] text-zinc-500">{tab === "queued" ? "Nothing is waiting to publish." : "Nothing published from this queue yet."}</p>
          ) : null
        ) : (
          <>
            <ul className={tab === "queued" ? (queueView === "thumbs" ? "grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2" : "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3") : "grid grid-cols-[repeat(auto-fit,minmax(440px,1fr))] gap-4"}>
            {shown.map((post) => (
              <QueueRow
                key={post.id}
                post={post}
                folders={folders}
                compact={tab !== "queued" && shown.length > 1}
                layout={tab === "queued" ? queueView === "thumbs" ? "thumb" : "card" : "row"}
                showTags={tab !== "queued" || queueView === "cards"}
                dragging={dragId === post.id}
                onChanged={() => void reload()}
                onDragStart={tab === "queued" && queueView === "cards" && post.status !== "posting" ? () => {
                  setDragId(post.id);
                  const ids = shown.map((item) => item.id);
                  queueOrderRef.current = ids;
                  setQueueOrder(ids);
                } : undefined}
                onDragOver={tab === "queued" && queueView === "cards" ? () => moveQueued(post.id) : undefined}
                onDragEnd={tab === "queued" && queueView === "cards" ? () => void finishDrag() : undefined}
              />
            ))}
          </ul>
          </>
        )}
        {tab === "published" && saved.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Uploaded here</h2>
            <ul className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-4">
              {saved.map((item) => (
                <PublishRow key={item.itemid} item={item} onChange={() => setSaved(localStash())} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function UploadBox({
  fill,
  destination,
  alreadyMarked,
  onDestination,
  onAlreadyMarked,
  onFiles,
}: {
  fill: boolean;
  destination: "publish" | "stash";
  alreadyMarked: boolean;
  onDestination: (destination: "publish" | "stash") => void;
  onAlreadyMarked: (marked: boolean) => void;
  onFiles: (files: File[]) => void;
}) {
  const choice = "flex items-center gap-2 text-[13px] text-zinc-200";
  return (
    <div className={`mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className={choice}>
          <input type="radio" name="upload-destination" className="accent-da" checked={destination === "publish"} onChange={() => onDestination("publish")} />
          Queue for publish
        </label>
        <label className={choice}>
          <input type="radio" name="upload-destination" className="accent-da" checked={destination === "stash"} onChange={() => onDestination("stash")} />
          Send to Stash
        </label>
        <label className={choice}>
          <input type="checkbox" className="accent-da" checked={alreadyMarked} onChange={(event) => onAlreadyMarked(event.target.checked)} />
          No watermarks required
        </label>
      </div>
      <FileDrop
        className={`group flex cursor-pointer flex-col items-start justify-between rounded-xl border border-dashed border-white/15 px-4 hover:border-white/30 ${fill ? "min-h-0 flex-1 py-6" : "h-24 py-4"}`}
        onFiles={onFiles}
        label={
          <>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-zinc-100 group-hover:bg-white/10">
              <UploadMark className="h-5 w-5" />
            </span>
            <span className="text-[13px] text-zinc-400">Drop images</span>
          </>
        }
      />
    </div>
  );
}

function UploadMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M8 2.2v7.2M8 2.2 5.2 5M8 2.2 10.8 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9.2V12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function FileDrop({ label, className, onFiles }: { label: ReactNode; className: string; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`${className} ${over ? "ring-2 ring-da" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles([...(event.dataTransfer.files ?? [])]);
      }}
    >
      {label}
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.bmp,.gif,image/png,image/jpeg,image/bmp,image/gif"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          onFiles(files);
        }}
      />
    </label>
  );
}

const statusLabel: Record<QueuePost["status"], string> = {
  titling: "Titling",
  review: "Review",
  waiting: "Queued",
  submitted: "Queued",
  posting: "Publishing",
  published: "Published",
  stashed: "In Stash",
  failed: "Failed",
};

function publishedWhen(ms: number): string {
  if (!ms) return "Published";
  return new Date(ms).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function QueueRow({
  post,
  folders,
  compact,
  layout,
  showTags,
  dragging,
  onChanged,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  post: QueuePost;
  folders: GalleryFolder[];
  compact: boolean;
  layout: "row" | "card" | "thumb";
  showTags: boolean;
  dragging?: boolean;
  onChanged: () => void;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDragEnd?: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [tags, setTags] = useState(post.tags);
  const [mature, setMature] = useState(post.mature === true);
  const [ai, setAi] = useState(post.ai !== false);
  const [noai, setNoai] = useState(post.noai === true);
  const [galleries, setGalleries] = useState<string[]>(post.galleries ?? []);
  const [rowError, setRowError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [confirm, setConfirm] = useState<null | "publish" | "remove">(null);
  const locked = post.status === "published" || post.status === "posting" || post.status === "stashed" || publishing;
  const editing = !locked && (post.status === "review" || post.status === "titling" || layout === "card");

  useEffect(() => {
    setTitle(post.title);
    setTags(post.tags);
    setMature(post.mature === true);
    setAi(post.ai !== false);
    setNoai(post.noai === true);
    setGalleries(post.galleries ?? []);
  }, [post.id, post.status, post.title, post.tags, post.mature, post.ai, post.noai, (post.galleries ?? []).join(",")]);

  async function save(flags = { mature, ai, noai, galleries }) {
    if (locked) return;
    await updateQueuedPost(post.id, title, tags, flags);
  }

  async function approve() {
    setRowError("");
    try {
      await save();
      if (post.studio) await submitToStudio(post.id);
      else await approveQueuedPost(post.id);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Save a title and some tags first.");
    }
  }

  async function publishNow() {
    setConfirm(null);
    setRowError("");
    setPublishing(true);
    try {
      await save();
      await publishQueuedNow(post.id);
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Could not publish that file.");
    } finally {
      setPublishing(false);
    }
  }

  async function remove() {
    setConfirm(null);
    await removeQueuedPost(post.id);
    onChanged();
  }

  const canPublishNow = post.status === "waiting" || post.status === "submitted" || post.status === "failed";

  const label = title.trim() || post.name;
  const confirmBox = confirm ? (
    <ConfirmDialog
      title={label}
      thumb={`/da-queue/posts/${post.id}/thumb`}
      message={confirm === "publish" ? "Publish this now?" : "Remove this file?"}
      confirmLabel={confirm === "publish" ? "Publish now" : "Remove"}
      danger={confirm === "remove"}
      onCancel={() => setConfirm(null)}
      onConfirm={() => void (confirm === "publish" ? publishNow() : remove())}
    />
  ) : null;

  if (layout === "thumb") {
    return (
      <>
      <li className="relative overflow-hidden rounded-md bg-black">
        <img
          src={`/da-queue/posts/${post.id}/thumb`}
          alt={post.title || post.name}
          draggable={false}
          className="h-auto w-full"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        {canPublishNow ? (
          <button
            type="button"
            disabled={publishing}
            aria-label={publishing ? "Publishing" : "Publish now"}
            onClick={() => setConfirm("publish")}
            className="absolute right-1.5 bottom-1.5 text-da hover:text-[#3ad866] disabled:opacity-60"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]" fill="none" aria-hidden="true">
              <path d="M8 2.4v7M8 2.4 5.4 5M8 2.4 10.6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.2 9.2v3.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V9.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
        {rowError ? <p className="px-2 py-1 text-[11px] text-zinc-400">{rowError}</p> : null}
      </li>
      {confirmBox}
    </>
    );
  }

  return (
    <>
    <li
      className={`flex min-w-0 overflow-hidden rounded-lg border border-lab-line ${layout === "card" || compact ? "flex-col" : ""} ${dragging ? "opacity-40" : ""}`}
      onDragOver={onDragOver ? (event) => {
        event.preventDefault();
        onDragOver();
      } : undefined}
    >
      <div className={layout === "card" ? "relative flex items-center justify-center bg-black" : onDragStart ? "flex h-28 w-40 shrink-0 items-center justify-center bg-black" : compact ? "flex h-56 items-center justify-center bg-black" : "flex w-[min(46%,520px)] shrink-0 items-center justify-center bg-black"}>
        {onDragStart ? (
          <button
            type="button"
            draggable
            aria-label="Drag to reorder"
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", post.id);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            className={layout === "card" ? "absolute top-1 left-1 grid h-7 w-7 cursor-grab place-items-center rounded bg-black/60 text-zinc-300 active:cursor-grabbing" : "grid w-8 shrink-0 cursor-grab place-items-center text-zinc-500 active:cursor-grabbing"}
          >
            <svg viewBox="0 0 10 16" className="h-4 w-3" aria-hidden="true">
              <path fill="currentColor" d="M1 1h2v2H1zm6 0h2v2H7zM1 7h2v2H1zm6 0h2v2H7zM1 13h2v2H1zm6 0h2v2H7z" />
            </svg>
          </button>
        ) : null}
        <img
          src={`/da-queue/posts/${post.id}/thumb`}
          alt=""
          draggable={false}
          className={layout === "card" ? "h-auto w-full" : onDragStart || compact ? "h-full w-full object-contain" : "max-h-[420px] w-full object-contain"}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <input
            value={title}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void save()}
            placeholder={post.name}
            aria-label="Title"
            className="h-8 min-w-0 flex-1 rounded-md border border-lab-line bg-transparent px-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-60"
          />
          {post.watermark === false ? <span className="shrink-0 text-[11px] text-zinc-500">No watermark</span> : null}
          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{post.status === "published" ? publishedWhen(post.publishedAt || post.createdAt) : statusLabel[post.status]}</span>
        </div>
        {showTags ? (
          <label className="block text-[12px] text-zinc-500">
            Tags ({stashTags(tags).length})
            <textarea
              value={tags}
              rows={layout === "card" || compact ? 3 : 5}
              disabled={locked}
              onChange={(event) => setTags(event.target.value)}
              onBlur={() => void save()}
              placeholder="Tags, separated by commas"
              className="mt-1 min-h-24 w-full flex-1 resize-y rounded-md border border-lab-line bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-500 disabled:opacity-60"
            />
          </label>
        ) : null}
        {editing ? (
          <div className={`flex gap-x-4 gap-y-2 text-[12px] text-zinc-300 ${layout === "card" ? "flex-col" : "flex-wrap"}`}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mature} onChange={(event) => {
                const next = { mature: event.target.checked, ai, noai, galleries };
                setMature(next.mature);
                void save(next);
              }} />
              Mature
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ai} onChange={(event) => {
                const next = { mature, ai: event.target.checked, noai, galleries };
                setAi(next.ai);
                void save(next);
              }} />
              AI generated
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={noai} onChange={(event) => {
                const next = { mature, ai, noai: event.target.checked, galleries };
                setNoai(next.noai);
                void save(next);
              }} />
              Do not include in third-party AI datasets
            </label>
          </div>
        ) : null}
        {!locked && !post.studio && folders.length > 0 ? (
          <fieldset className="max-h-40 space-y-1.5 overflow-y-auto text-[12px] text-zinc-300">
            <legend className="text-[12px] text-zinc-500">Folders</legend>
            {folders.map((folder) => {
              const checked = galleries.includes(folder.id);
              return (
                <label key={folder.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const nextIds = checked ? galleries.filter((id) => id !== folder.id) : [...galleries, folder.id];
                      const next = { mature, ai, noai, galleries: nextIds };
                      setGalleries(nextIds);
                      void save(next);
                    }}
                  />
                  {folderLabel(folder, folders)}
                </label>
              );
            })}
          </fieldset>
        ) : null}
        {post.error ? <p className="text-[12px] text-zinc-400">{post.error}</p> : null}
        {rowError ? <p className="text-[12px] text-zinc-400">{rowError}</p> : null}
        <div className="mt-auto flex gap-2">
          {post.status === "review" ? (
            <button type="button" onClick={() => void approve()} className="h-8 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866]">
              {post.studio ? "Send to Stash" : "Add to queue"}
            </button>
          ) : null}
          {canPublishNow ? (
            <button type="button" disabled={publishing} onClick={() => setConfirm("publish")} className="h-8 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866] disabled:opacity-60">
              {publishing ? "Publishing" : "Publish now"}
            </button>
          ) : null}
          {post.status === "failed" ? (
            <button type="button" onClick={() => void retryQueuedPost(post.id).then(onChanged)} className="h-8 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866]">
              Retry
            </button>
          ) : null}
          {post.url ? <a href={post.url} target="_blank" rel="noreferrer" className="grid h-8 place-items-center px-2 text-[12px] text-zinc-300 hover:text-da">Open</a> : null}
          {post.status === "waiting" || post.status === "failed" || post.status === "submitted" || post.status === "review" || post.status === "titling" || post.status === "stashed" ? (
            <button type="button" onClick={() => setConfirm("remove")} className="h-8 px-2 text-[12px] text-zinc-400 hover:text-zinc-100">
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </li>
    {confirmBox}
    </>
  );
}

function ConfirmDialog({
  title,
  thumb,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  thumb: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancelRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="queue-confirm-title"
      onClick={onCancel}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-lab-line bg-lab-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex max-h-72 items-center justify-center bg-black">
          <img
            src={thumb}
            alt=""
            className="max-h-72 w-full object-contain"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
        <div className="space-y-4 p-4">
          <div>
            <p id="queue-confirm-title" className="truncate text-[15px] font-medium text-zinc-100">{title}</p>
            <p className="mt-1 text-[13px] text-zinc-400">{message}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button ref={cancelRef} type="button" onClick={onCancel} className="h-8 rounded-md border border-lab-line px-3 text-[12px] font-medium text-zinc-200 hover:border-zinc-500">
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={danger ? "h-8 rounded-md bg-red-600 px-3 text-[12px] font-semibold text-white hover:bg-red-500" : "h-8 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866]"}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function plainPublishError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Publish failed.";
  if (/higher scope|re-authorize|reauthorize|insufficient/i.test(message)) {
    return "Sign out and sign in again, then approve publish access. This login was created before uploads were allowed.";
  }
  return message;
}

function PublishRow({ item, onChange }: { item: LocalStashItem; onChange: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [mature, setMature] = useState(() => readSettings().publishMature);
  const [ai, setAi] = useState(() => readSettings().publishAi);
  const [noai, setNoai] = useState(() => readSettings().publishNoai);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function publish() {
    setBusy(true);
    setError("");
    try {
      const result = await publishStash({
        itemid: item.itemid,
        tags: stashTags(tags),
        mature,
        aiGenerated: ai,
        noai,
      });
      updateLocalStash(item.itemid, { title, tags: stashTags(tags), url: result.url, deviationId: result.deviationId });
      onChange();
    } catch (err) {
      setError(plainPublishError(err));
    } finally {
      setBusy(false);
    }
  }

  async function writeTags() {
    if (!item.deviationId) return;
    setBusy(true);
    setError("");
    try {
      const next = stashTags(tags);
      await editPublishedTags(item.deviationId, next);
      updateLocalStash(item.itemid, { tags: next, title });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "DeviantArt did not take those tags. They are still in this box.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-lab-line p-3">
      <div className="flex gap-3">
        {item.thumb ? <img src={item.thumb} alt="" className="h-14 w-14 rounded-md object-cover" /> : null}
        <div className="min-w-0 flex-1 space-y-2">
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="h-8 w-full rounded-md border border-lab-line bg-transparent px-2 text-[13px] text-zinc-100 outline-none focus:border-zinc-500" />
          <label className="block text-[12px] text-zinc-500">
            Tags ({stashTags(tags).length})
            <textarea
              value={tags}
              rows={5}
              onChange={(event) => setTags(event.target.value)}
              className="mt-1 w-full resize-y rounded-md border border-lab-line bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-zinc-100 outline-none focus:border-zinc-500"
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={mature} onChange={(event) => setMature(event.target.checked)} />
            Mature
          </label>
          <label className="flex items-center gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={ai} onChange={(event) => setAi(event.target.checked)} />
            AI generated
          </label>
          <label className="flex items-center gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={noai} onChange={(event) => setNoai(event.target.checked)} />
            Do not include in third-party AI datasets
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || Boolean(item.deviationId)} onClick={() => void publish()} className="h-8 rounded-md bg-da px-3 text-[12px] font-semibold text-black hover:bg-[#3ad866] disabled:opacity-40">
              {item.deviationId ? "Published" : "Publish"}
            </button>
            {item.deviationId ? (
              <button type="button" disabled={busy} onClick={() => void writeTags()} className="h-8 rounded-md border border-lab-line px-3 text-[12px] font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-40">
                Save tags
              </button>
            ) : null}
            {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="grid h-8 place-items-center px-2 text-[12px] text-zinc-300 hover:text-da">Open</a> : null}
          </div>
          {error ? <p className="text-[12px] text-zinc-400">{error}</p> : null}
        </div>
      </div>
    </li>
  );
}
