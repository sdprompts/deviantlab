import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PageHeader } from "../components/PageHeader";
import { useLab } from "../lab";
import { folderLabel, loadGalleryFolders, type GalleryFolder } from "../lib/da/folders";
import { clearLocalStash } from "../lib/da/stash";
import { clearQueueHistory } from "../lib/studio/queueClient";
import {
  clearWatermark,
  readSettings,
  readWatermark,
  saveWatermark,
  updateSettings,
  type VisionProvider,
  type WatermarkCorner,
  markWidthOf,
  promptOf,
  defaultTagsOf,
  defaultVisionPrompt,
  tagCountOf,
  temperatureOf,
  visionForProvider,
} from "../lib/settings";

const field = "h-8 w-full rounded-md border border-lab-line bg-lab px-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500";

export function SettingsPage() {
  const { session } = useLab();
  const [settings, setSettings] = useState(() => readSettings());
  const [watermark, setWatermark] = useState(() => readWatermark());
  const [minutes, setMinutes] = useState(() => String(readSettings().scheduleMinutes));
  const [markWidth, setMarkWidth] = useState(() => String(readSettings().watermarkWidth));
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewOver, setPreviewOver] = useState(false);
  const [confirmHistory, setConfirmHistory] = useState(false);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [historyNote, setHistoryNote] = useState("");
  const [clips, setClips] = useState<string[]>([]);
  const [clipNote, setClipNote] = useState("");
  const [creativity, setCreativity] = useState(() => readSettings().visionTemperature);
  const [tagCount, setTagCount] = useState(() => String(readSettings().visionTagCount));
  const [tagDefaults, setTagDefaults] = useState(() => readSettings().defaultTags);
  const [promptText, setPromptText] = useState(() => readSettings().visionPrompt || defaultVisionPrompt);
  const [folders, setFolders] = useState<GalleryFolder[]>([]);

  useEffect(() => {
    if (!session) {
      setFolders([]);
      return;
    }
    let cancel = false;
    void loadGalleryFolders(session.username).then((list) => {
      if (!cancel) setFolders(list);
    }).catch(() => {
      if (!cancel) setFolders([]);
    });
    return () => {
      cancel = true;
    };
  }, [session]);

  async function loadClips(base: string) {
    try {
      const response = await fetch(`/da-vision/clips?base=${encodeURIComponent(base)}`);
      const body = (await response.json()) as { clips?: string[]; error_description?: string };
      if (!response.ok) {
        setClips([]);
        setClipNote(body.error_description || "ComfyUI is not running.");
        return;
      }
      const names = body.clips ?? [];
      setClips(names);
      setClipNote(names.length ? "" : "ComfyUI has no CLIP files.");
    } catch {
      setClips([]);
      setClipNote("ComfyUI is not running.");
    }
  }

  useEffect(() => {
    setSettings(readSettings());
  }, [settings.visionProvider]);

  useEffect(() => {
    if (settings.visionProvider !== "comfyui") return;
    void loadClips(settings.visionBaseUrl);
  }, [settings.visionProvider]);

  function save<K extends keyof ReturnType<typeof readSettings>>(key: K, value: ReturnType<typeof readSettings>[K]) {
    updateSettings({ [key]: value });
    setSettings(readSettings());
  }

  function saveModel(model: string) {
    updateSettings({
      visionModel: model,
      visionModels: { ...settings.visionModels, [settings.visionProvider]: model },
    });
    setSettings(readSettings());
  }

  function chooseProvider(next: VisionProvider) {
    updateSettings(visionForProvider(settings, next));
    setSettings(readSettings());
  }

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl("");
      return;
    }
    let cancel = false;
    void composeWatermarkPreview(previewFile, watermark, settings.watermarkCorner, settings.watermarkWidth).then((url) => {
      if (!cancel) setPreviewUrl(url);
    });
    return () => {
      cancel = true;
    };
  }, [previewFile, watermark, settings.watermarkCorner, settings.watermarkWidth]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader kicker="Settings" title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <div className="space-y-6">
          <Section title="Publishing">
          <label className="block text-[12px] text-zinc-400">
            Post every
            <span className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={5}
                max={1440}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                onBlur={() => {
                  const next = Math.round(Number(minutes));
                  const clamped = Number.isFinite(next) ? Math.min(1440, Math.max(5, next)) : settings.scheduleMinutes;
                  setMinutes(String(clamped));
                  save("scheduleMinutes", clamped);
                }}
                className={`${field} max-w-24`}
              />
              <span>minutes</span>
            </span>
          </label>
          <label className="block text-[12px] text-zinc-400">
            Your name or copyright, added to the image metadata when sent
            <input value={settings.credit} onChange={(event) => save("credit", event.target.value)} placeholder="© Your name" className={`mt-1 ${field}`} />
          </label>
          <div className="space-y-2 border-t border-lab-line pt-3">
            <p className="text-[13px] font-medium text-zinc-100">Applied to each new upload</p>
            <DefaultToggle label="Mature" on={settings.publishMature} onClick={() => save("publishMature", !settings.publishMature)} />
            <DefaultToggle label="AI generated" on={settings.publishAi} onClick={() => save("publishAi", !settings.publishAi)} />
            <DefaultToggle label="Do not include in third-party AI datasets" on={settings.publishNoai} onClick={() => save("publishNoai", !settings.publishNoai)} />
            <label className="block pt-1 text-[12px] text-zinc-400">
              Default folder
              <select
                value={settings.defaultFolder}
                onChange={(event) => save("defaultFolder", event.target.value)}
                className={`mt-1 ${field}`}
              >
                <option value="featured">Featured</option>
                <option value="none">None</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folderLabel(folder, folders)}</option>
                ))}
                {settings.defaultFolder !== "featured" && settings.defaultFolder !== "none" && !folders.some((folder) => folder.id === settings.defaultFolder) ? (
                  <option value={settings.defaultFolder}>Saved folder</option>
                ) : null}
              </select>
              <span className="mt-1 block text-zinc-500">{session ? "Checked on each new upload. You can change it on that file." : "Sign in to choose one of your gallery folders."}</span>
            </label>
          </div>
          </Section>
          <Section title="Watermark">
            <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {watermark ? (
                <img src={watermark} alt="" className="max-h-28 max-w-full object-contain" />
              ) : (
                <p className="text-[12px] text-zinc-500">None</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {watermark ? (
                <button
                  type="button"
                  onClick={() => {
                    clearWatermark();
                    setWatermark("");
                  }}
                  className="text-[12px] text-zinc-400 hover:text-zinc-100"
                >
                  Remove
                </button>
              ) : null}
              <label className="h-7 cursor-pointer rounded-md border border-lab-line px-2.5 text-[12px] leading-7 font-medium text-zinc-200 hover:border-zinc-500">
                Choose PNG
                <input
                  type="file"
                  accept="image/png"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file || file.size > 1_500_000) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const url = typeof reader.result === "string" ? reader.result : "";
                      saveWatermark(url);
                      setWatermark(url);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] text-zinc-400">
                Width
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={40}
                    max={2000}
                    value={markWidth}
                    onChange={(event) => setMarkWidth(event.target.value)}
                    onBlur={() => {
                      const next = markWidthOf(markWidth);
                      setMarkWidth(String(next));
                      save("watermarkWidth", next);
                    }}
                    className={`${field} max-w-24`}
                  />
                  <span>px</span>
                </span>
              </label>
              <label className="text-[12px] text-zinc-400">
                Corner
                <select
                  value={settings.watermarkCorner}
                  onChange={(event) => save("watermarkCorner", event.target.value as WatermarkCorner)}
                  className={`mt-1 ${field}`}
                >
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                </select>
              </label>
            </div>
            <label
              className={`block cursor-pointer rounded-lg border border-dashed px-3 py-4 text-[12px] text-zinc-400 ${previewOver ? "border-da text-zinc-200" : "border-white/15"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setPreviewOver(true);
              }}
              onDragLeave={() => setPreviewOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setPreviewOver(false);
                const file = [...(event.dataTransfer.files ?? [])].find((item) => item.type.startsWith("image/"));
                if (file) setPreviewFile(file);
              }}
            >
              Drop an image to preview
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) setPreviewFile(file);
                }}
              />
            </label>
            {previewUrl ? <img src={previewUrl} alt="" className="max-h-80 w-full rounded-md object-contain" /> : null}
          </Section>
          <Section title="History">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-zinc-400">{historyNote || "Published and sent images"}</p>
              <button
                type="button"
                onClick={() => {
                  setRemoveFiles(false);
                  setConfirmHistory(true);
                }}
                className="h-8 shrink-0 rounded-md border border-lab-line px-3 text-[12px] font-medium text-zinc-200 hover:border-zinc-500"
              >
                Clear history
              </button>
            </div>
          </Section>
          </div>
          <div className="space-y-6">
          <Section title="Titles and tags">
            <DefaultToggle label="Suggest titles and tags" on={settings.visionEnabled} onClick={() => save("visionEnabled", !settings.visionEnabled)} />
            <label className="block text-[12px] text-zinc-400">
              Tags to write
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={tagCount}
                  onChange={(event) => setTagCount(event.target.value)}
                  onBlur={() => {
                    const next = tagCountOf(tagCount);
                    setTagCount(String(next));
                    save("visionTagCount", next);
                  }}
                  className={`${field} max-w-24`}
                />
              </span>
              <span className="mt-1 block text-zinc-500">From 1 to 30. 25 is the default. Each new title uses this many tags.</span>
            </label>
            <label className="block text-[12px] text-zinc-400">
              Default tags
              <input
                value={tagDefaults}
                onChange={(event) => setTagDefaults(event.target.value)}
                onBlur={() => {
                  const next = defaultTagsOf(tagDefaults);
                  setTagDefaults(next);
                  save("defaultTags", next);
                }}
                placeholder="portrait, fantasy"
                className={`mt-1 ${field}`}
              />
              <span className="mt-1 block text-zinc-500">Added to every new upload. Separate them with commas. You can edit them on that file.</span>
            </label>
            <label className="block text-[12px] text-zinc-400">
              Title and tag instructions
              <textarea
                value={promptText}
                rows={8}
                onChange={(event) => setPromptText(event.target.value)}
                onBlur={() => {
                  const next = promptOf(promptText);
                  setPromptText(next);
                  save("visionPrompt", next);
                }}
                className="mt-1 min-h-80 w-full rounded-md border border-lab-line bg-lab px-3 py-2 text-[13px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
              />
              <span className="mt-1 block text-zinc-500">Sent with every title. The reply format stays fixed.</span>
            </label>
          {settings.visionEnabled ? (
            <>
              <div className="grid grid-cols-2 gap-3 border-t border-lab-line pt-3">
                <label className="text-[12px] text-zinc-400">
                  Provider
                  <select
                    value={settings.visionProvider}
                    onChange={(event) => chooseProvider(event.target.value as VisionProvider)}
                    className={`mt-1 ${field}`}
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="lmstudio">LM Studio</option>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="grok">Grok</option>
                    <option value="gemini">Gemini</option>
                    <option value="comfyui">ComfyUI</option>
                  </select>
                </label>
                {settings.visionProvider === "comfyui" ? (
                  <label className="text-[12px] text-zinc-400">
                    CLIP model
                    {clips.length ? (
                      <select
                        value={settings.visionModel}
                        onChange={(event) => saveModel(event.target.value)}
                        className={`mt-1 ${field}`}
                      >
                        <option value="">Choose a vision model</option>
                        {(settings.visionModel && !clips.includes(settings.visionModel) ? [settings.visionModel, ...clips] : clips).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={settings.visionModel}
                        onChange={(event) => saveModel(event.target.value)}
                        placeholder="qwen3vl_4b_bf16.safetensors"
                        className={`mt-1 ${field}`}
                      />
                    )}
                  </label>
                ) : (
                  <label className="text-[12px] text-zinc-400">
                    Model id
                    <input
                      value={settings.visionModel}
                      onChange={(event) => saveModel(event.target.value)}
                      placeholder={visionGuide(settings.visionProvider).models[0]?.id}
                      className={`mt-1 ${field}`}
                    />
                  </label>
                )}
              </div>
              {settings.visionProvider === "comfyui" ? (
                <div className="space-y-1.5">
                  {clipNote ? <p className="text-[12px] text-zinc-500">{clipNote}</p> : null}
                  <p className="text-[12px] text-zinc-500">The list is every model in your text encoders folder. You have to select a vision model. A click below fills the CLIP model. Put the download in ComfyUI’s models/text_encoders folder.</p>
                  {visionGuide("comfyui").models.map((item) => (
                    <div key={item.id} className={`rounded-md border ${settings.visionModel === item.id ? "border-da" : "border-lab-line"}`}>
                      <button
                        type="button"
                        onClick={() => saveModel(item.id)}
                        className="block w-full px-2.5 py-1.5 text-left"
                      >
                        <span className="block text-[12px] font-medium text-zinc-100">{item.id}</span>
                        <span className="block text-[12px] text-zinc-500">{item.why}</span>
                      </button>
                      {item.href ? (
                        <a href={item.href} target="_blank" rel="noreferrer" className="block px-2.5 pb-1.5 text-[12px] text-da">Download</a>
                      ) : null}
                    </div>
                  ))}
                  <label className="block text-[12px] text-zinc-400">
                    <span className="flex items-center justify-between">
                      Creativity
                      <span className="text-zinc-200">{creativity.toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={0.01}
                      max={2}
                      step={0.01}
                      value={creativity}
                      onChange={(event) => setCreativity(temperatureOf(Number(event.target.value)))}
                      onPointerUp={(event) => save("visionTemperature", temperatureOf(Number(event.currentTarget.value)))}
                      onKeyUp={(event) => save("visionTemperature", temperatureOf(Number(event.currentTarget.value)))}
                      onBlur={(event) => save("visionTemperature", temperatureOf(Number(event.currentTarget.value)))}
                      className="mt-2 w-full accent-da"
                    />
                  </label>
                  <p className="text-[12px] text-zinc-500">Lower stays closer to the picture. Higher varies the title and tags. ComfyUI has to be running. Each tag is one word for the subject, the place, and the defining objects, plus style words such as portrait or cinematic, art styles such as realism or painting, and a period joined into one word such as ancientegypt. Colours and abstract words are left out.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[12px] text-zinc-500">Suggestions for this provider. A click fills the model id. The provider does not fill it for you.</p>
                  {visionGuide(settings.visionProvider).models.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => saveModel(item.id)}
                      className={`block w-full rounded-md border px-2.5 py-1.5 text-left ${settings.visionModel === item.id ? "border-da" : "border-lab-line hover:border-zinc-500"}`}
                    >
                      <span className="block text-[12px] font-medium text-zinc-100">{item.id}</span>
                      <span className="block text-[12px] text-zinc-500">{item.why}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="block text-[12px] text-zinc-400">
                Base URL
                <input
                  value={settings.visionBaseUrl}
                  onChange={(event) => save("visionBaseUrl", event.target.value)}
                  onBlur={(event) => {
                    if (settings.visionProvider === "comfyui") void loadClips(event.currentTarget.value);
                  }}
                  placeholder={settings.visionProvider === "claude" ? "Ignored for Claude" : settings.visionProvider === "comfyui" ? "Blank uses http://127.0.0.1:8188" : "Blank uses the provider default"}
                  className={`mt-1 ${field}`}
                />
              </label>
              {settings.visionProvider === "comfyui" ? null : (
              <label className="block text-[12px] text-zinc-400">
                {visionGuide(settings.visionProvider).keyLabel}
                <input
                  type="password"
                  value={settings.visionKey}
                  onChange={(event) => save("visionKey", event.target.value)}
                  disabled={settings.visionProvider === "lmstudio"}
                  placeholder={settings.visionProvider === "lmstudio" ? "Leave empty" : ""}
                  className={`mt-1 ${field} disabled:opacity-50`}
                />
              </label>
              )}
            </>
          ) : null}
          </Section>
          </div>
        </div>
      </div>
      {confirmHistory ? (
        <HistoryDialog
          removeFiles={removeFiles}
          busy={clearing}
          onRemoveFiles={setRemoveFiles}
          onCancel={() => {
            if (!clearing) setConfirmHistory(false);
          }}
          onConfirm={() => {
            setClearing(true);
            setHistoryNote("");
            void clearQueueHistory(removeFiles)
              .then(() => {
                clearLocalStash();
                setHistoryNote("Cleared.");
                setConfirmHistory(false);
                setRemoveFiles(false);
              })
              .catch((err: unknown) => {
                setHistoryNote(err instanceof Error ? err.message : "Could not clear that history.");
              })
              .finally(() => setClearing(false));
          }}
        />
      ) : null}
    </div>
  );
}

function HistoryDialog({
  removeFiles,
  busy,
  onRemoveFiles,
  onCancel,
  onConfirm,
}: {
  removeFiles: boolean;
  busy: boolean;
  onRemoveFiles: (value: boolean) => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" role="dialog" aria-modal="true" aria-labelledby="history-confirm-title" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-lab-line bg-lab-panel p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <p id="history-confirm-title" className="text-[15px] font-medium text-zinc-100">Clear history</p>
        <p className="mt-1 text-[13px] text-zinc-400">Published and sent images leave this app. DeviantArt keeps the ones already there.</p>
        <label className="mt-4 flex items-center gap-2 text-[13px] text-zinc-200">
          <input type="checkbox" checked={removeFiles} disabled={busy} onChange={(event) => onRemoveFiles(event.target.checked)} />
          Also delete the copies kept on this computer
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="h-8 rounded-md border border-lab-line px-3 text-[12px] font-medium text-zinc-200 hover:border-zinc-500">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="h-8 rounded-md bg-red-600 px-3 text-[12px] font-semibold text-white hover:bg-red-500 disabled:opacity-60">
            Clear history
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = src;
  });
}

async function composeWatermarkPreview(file: File, markUrl: string, corner: string, widthPx: number): Promise<string> {
  const artUrl = URL.createObjectURL(file);
  try {
    const art = await loadImage(artUrl);
    const canvas = document.createElement("canvas");
    const maxEdge = 1200;
    const scale = Math.min(1, maxEdge / Math.max(art.width, art.height, 1));
    canvas.width = Math.max(1, Math.round(art.width * scale));
    canvas.height = Math.max(1, Math.round(art.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(art, 0, 0, canvas.width, canvas.height);
    if (markUrl) {
      const mark = await loadImage(markUrl);
      const markWidth = Math.min(Math.round(widthPx * scale), canvas.width);
      const markHeight = mark.width > 0 ? Math.round((mark.height * markWidth) / mark.width) : 0;
      const margin = Math.max(1, Math.round(12 * scale));
      const left = corner.endsWith("right") ? Math.max(0, canvas.width - markWidth - margin) : Math.min(margin, Math.max(0, canvas.width - markWidth));
      const top = corner.startsWith("bottom") ? Math.max(0, canvas.height - markHeight - margin) : Math.min(margin, Math.max(0, canvas.height - markHeight));
      ctx.drawImage(mark, left, top, markWidth, markHeight);
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(artUrl);
  }
}

function visionGuide(provider: VisionProvider): { models: { id: string; why: string; href?: string }[]; keyLabel: string } {
  switch (provider) {
    case "gemini":
      return {
        models: [
          { id: "gemini-2.5-flash", why: "Start here. Reads the picture and is the cheap Gemini model." },
          { id: "gemini-2.5-pro", why: "When Flash titles are flat. Costs more than Flash." },
        ],
        keyLabel: "API key from Google AI Studio",
      };
    case "openrouter":
      return {
        models: [
          { id: "google/gemma-4-26b-a4b-it", why: "Start here. Reads images and is the cheap one, about $0.04 per million input tokens." },
          { id: "google/gemini-2.5-flash", why: "When Gemma titles are flat. About $0.30 per million input tokens." },
          { id: "anthropic/claude-haiku-4.5", why: "When the cheaper titles are flat. About $1 per million input tokens." },
        ],
        keyLabel: "API key from OpenRouter",
      };
    case "lmstudio":
      return {
        models: [
          { id: "qwen/qwen3-vl-4b", why: "Start here. Use the Instruct build, loaded in LM Studio." },
          { id: "qwen/qwen3-vl-8b", why: "When the 4B titles are thin and the machine can hold it." },
          { id: "qwen/qwen3-vl-2b", why: "When the 4B model does not fit. Needs about 3 GB." },
        ],
        keyLabel: "No API key. Leave this empty.",
      };
    case "openai":
      return {
        models: [
          { id: "gpt-4.1-mini", why: "Start here. Accepts images and is the cheap OpenAI model." },
          { id: "gpt-4.1", why: "When mini titles are flat. Costs more than mini." },
        ],
        keyLabel: "API key from OpenAI",
      };
    case "claude":
      return {
        models: [
          { id: "claude-haiku-4-5", why: "Start here. The fast Claude model that accepts images." },
          { id: "claude-sonnet-5", why: "When Haiku titles are flat. Costs more than Haiku." },
        ],
        keyLabel: "API key from the Claude console",
      };
    case "grok":
      return {
        models: [
          { id: "grok-4.3", why: "Start here. Accepts images. About $1.25 per million input tokens." },
          { id: "grok-4.7", why: "When 4.3 titles are flat. About $2 per million input tokens." },
        ],
        keyLabel: "API key from the xAI console",
      };
    case "comfyui":
      return {
        models: [
          { id: "qwen3vl_4b_fp8_scaled.safetensors", why: "Low VRAM. Qwen3-VL 4B vision model. FP8 file, 5.2 GB.", href: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
          { id: "qwen3vl_4b_bf16.safetensors", why: "Medium VRAM. Qwen3-VL 4B vision model. BF16 file, 8.9 GB.", href: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_bf16.safetensors" },
          { id: "qwen3vl_8b_fp8_scaled.safetensors", why: "16 GB VRAM. Qwen3-VL 8B vision model. FP8 file, 10.6 GB.", href: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_8b_fp8_scaled.safetensors" },
        ],
        keyLabel: "",
      };
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">{title}</h2>
      <div className="space-y-4 rounded-lg border border-lab-line bg-lab-panel p-4">{children}</div>
    </section>
  );
}

function DefaultToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-zinc-200">{label}</span>
      <button
        type="button"
        aria-pressed={on}
        onClick={onClick}
        className={`h-7 rounded-full px-3 text-[12px] font-semibold ${on ? "bg-da text-black" : "border border-lab-line text-zinc-300"}`}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}
