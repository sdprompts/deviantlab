export type VisionRequest = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  imageBase64?: string;
  mediaType?: string;
  temperature?: number;
};

const TITLE_RULE = "The title is a gallery artwork title: evocative, specific, and a little unexpected, a name for the mood, the stakes, or the moment. Metaphor is welcome when it fits the picture. Do not list the objects, and do not write a caption. 3 to 8 words, at most 50 characters, with no quotation marks.";

const PROMPT = `Look at the image. Reply with JSON only, no markdown: {"title":"...","tags":["..."]}. ${TITLE_RULE} Provide 20 to 30 tags. Join the words of a tag into one word. Remove spaces, hyphens, underscores, and other special characters, like scifi or postapocalyptic. No # and no sentences. Cover subject, mood, style, colours, and setting.`;

const COMFY_PROMPT = `Look at the image. Reply in exactly this format and nothing else:

Title: <${TITLE_RULE}>
Tags: <comma-separated tags, most specific first, 20 to 30 tags. Join the words of a tag. No spaces, no hyphens, and no special characters>`;

function oneTag(raw: string): string {
  const tag = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}]+/gu, "");
  return tag.length > 0 && tag.length <= 40 ? tag : "";
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = oneTag(item);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 30);
}

function readJson(text: string): { title: string; tags: string[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a title.");
  const parsed = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; tags?: unknown };
  const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 50) : "";
  return { title, tags: cleanTags(parsed.tags) };
}

function endpoint(provider: string, baseUrl: string, model: string): string {
  const root = baseUrl.replace(/\/$/, "");
  if (provider === "claude") return "https://api.anthropic.com/v1/messages";
  if (provider === "gemini") {
    const origin = root || "https://generativelanguage.googleapis.com/v1beta";
    return `${origin}/models/${encodeURIComponent(model)}:generateContent`;
  }
  if (provider === "openai") return `${root || "https://api.openai.com/v1"}/chat/completions`;
  if (provider === "grok") return `${root || "https://api.x.ai/v1"}/chat/completions`;
  if (provider === "lmstudio") return `${root || "http://localhost:1234/v1"}/chat/completions`;
  return `${root || "https://openrouter.ai/api/v1"}/chat/completions`;
}

function comfyRoot(baseUrl: string): string {
  return (baseUrl.trim() || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function temperatureOf(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0.7;
  return Math.min(2, Math.max(0.01, Math.round(next * 100) / 100));
}

function readAnswer(text: string): { title: string; tags: string[] } {
  try {
    const json = readJson(text);
    if (json.title || json.tags.length > 0) return json;
  } catch {
    // The ComfyUI reply is Title / Tags text.
  }
  const title = (text.match(/^Title:\s*(.+)$/im)?.[1] || "").replace(/^["']|["']$/g, "").trim().slice(0, 50);
  const tagsBlock = text.match(/^Tags:\s*([\s\S]+)$/im)?.[1] || "";
  const tags = cleanTags(tagsBlock.split(/[,\n]/));
  if (!title && tags.length === 0) throw new Error("The model did not return a title.");
  return { title, tags };
}

function comfyFailure(body: { error?: { message?: string }; node_errors?: Record<string, { errors?: { details?: string; message?: string }[] }> }): string {
  for (const node of Object.values(body.node_errors || {})) {
    const first = node.errors?.[0];
    if (first?.details) return first.details;
    if (first?.message) return first.message;
  }
  return body.error?.message || "ComfyUI did not queue the title.";
}

async function comfyText(root: string, promptId: string): Promise<string> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${root}/history/${promptId}`, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const history = (await response.json()) as Record<string, {
        status?: { status_str?: string; completed?: boolean; messages?: unknown };
        outputs?: Record<string, { text?: string[] }>;
      }>;
      const item = history[promptId];
      const text = item?.outputs?.["4"]?.text?.[0] || "";
      if (text) return text;
      if (item?.status?.status_str === "error" || (item?.status?.completed && !text)) {
        throw new Error(item?.status?.status_str === "error" ? historyError(item.status.messages) : "ComfyUI finished without a title.");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("ComfyUI took too long to title the image.");
}

function historyError(messages: unknown): string {
  if (!Array.isArray(messages)) return "ComfyUI could not generate a title.";
  for (const entry of messages) {
    if (!Array.isArray(entry) || !entry[1] || typeof entry[1] !== "object") continue;
    const message = (entry[1] as { exception_message?: unknown }).exception_message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 240);
  }
  return "ComfyUI could not generate a title.";
}

async function comfyVision(baseUrl: string, model: string, temperature: unknown, image: string, mediaType: string): Promise<{ title: string; tags: string[] }> {
  const root = comfyRoot(baseUrl);
  const ext = mediaType === "image/png" ? "png" : "jpg";
  const form = new FormData();
  form.append("image", new File([new Uint8Array(Buffer.from(image, "base64"))], `deviantlab-title.${ext}`, { type: mediaType || "image/jpeg" }));
  form.append("type", "input");
  form.append("overwrite", "true");
  let uploaded: Response;
  try {
    uploaded = await fetch(`${root}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("ComfyUI is not running.");
  }
  if (!uploaded.ok) throw new Error("ComfyUI did not accept the image.");
  const file = (await uploaded.json()) as { name?: string; subfolder?: string };
  const imageName = file.subfolder ? `${file.subfolder}/${file.name || ""}` : file.name || "";
  if (!imageName) throw new Error("ComfyUI did not accept the image.");
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const warmth = temperatureOf(temperature);
  const prompt = {
    "1": {
      class_type: "CLIPLoader",
      inputs: { clip_name: model, type: "stable_diffusion", device: "default" },
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: imageName },
    },
    "3": {
      class_type: "TextGenerate",
      inputs: {
        clip: ["1", 0],
        prompt: COMFY_PROMPT,
        image: ["2", 0],
        max_length: 512,
        sampling_mode: "on",
        "sampling_mode.temperature": warmth,
        "sampling_mode.top_k": 64,
        "sampling_mode.top_p": 0.95,
        "sampling_mode.min_p": 0.05,
        "sampling_mode.repetition_penalty": 1.05,
        "sampling_mode.seed": seed,
        "sampling_mode.presence_penalty": 0,
        thinking: false,
        use_default_template: true,
      },
    },
    "4": {
      class_type: "PreviewAny",
      inputs: { source: ["3", 0] },
    },
  };
  let queued: Response;
  try {
    queued = await fetch(`${root}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("ComfyUI is not running.");
  }
  const ticket = (await queued.json()) as { prompt_id?: string; error?: { message?: string }; node_errors?: Record<string, { errors?: { details?: string; message?: string }[] }> };
  if (!queued.ok || !ticket.prompt_id) throw new Error(comfyFailure(ticket));
  return readAnswer(await comfyText(root, ticket.prompt_id));
}

export async function listComfyClips(baseUrl: string): Promise<string[]> {
  const root = comfyRoot(baseUrl);
  let response: Response;
  try {
    response = await fetch(`${root}/models/text_encoders`, { signal: AbortSignal.timeout(8_000) });
  } catch {
    throw new Error("ComfyUI is not running.");
  }
  if (response.status === 404) {
    try {
      response = await fetch(`${root}/object_info/CLIPLoader`, { signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new Error("ComfyUI is not running.");
    }
    if (!response.ok) throw new Error("ComfyUI did not list CLIP files.");
    const info = (await response.json()) as { CLIPLoader?: { input?: { required?: { clip_name?: unknown[] } } } };
    const list = info.CLIPLoader?.input?.required?.clip_name?.[0];
    return Array.isArray(list) ? list.filter((name): name is string => typeof name === "string" && name.trim().length > 0) : [];
  }
  if (!response.ok) throw new Error("ComfyUI did not list CLIP files.");
  const names = (await response.json()) as unknown;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string" && name.trim().length > 0) : [];
}

export async function runVision(input: VisionRequest): Promise<{ title: string; tags: string[] }> {
  const provider = input.provider || "";
  const model = (input.model || "").trim();
  const image = input.imageBase64 || "";
  const mediaType = input.mediaType || "image/jpeg";
  if (!model) throw new Error(provider === "comfyui" ? "Choose a CLIP file in Settings." : "Set a vision model in Settings.");
  if (!image) throw new Error("This file has no image to title.");
  if (provider === "comfyui") {
    return comfyVision(input.baseUrl || "", model, input.temperature, image, mediaType);
  }
  if (provider !== "lmstudio" && !(input.apiKey || "").trim()) throw new Error("Set the vision API key in Settings.");

  const key = (input.apiKey || "").trim();
  let response: Response;
  if (provider === "claude") {
    response = await fetch(endpoint(provider, "", model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.95,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
  } else if (provider === "gemini") {
    response = await fetch(endpoint(provider, input.baseUrl || "", model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: mediaType, data: image } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 800, temperature: 0.95, responseMimeType: "application/json" },
      }),
    });
  } else {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    response = await fetch(endpoint(provider, input.baseUrl || "", model), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.95,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: `data:${mediaType};base64,${image}` } },
            ],
          },
        ],
      }),
    });
  }

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
    content?: { text?: string }[];
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!response.ok) throw new Error(payload.error?.message || "The vision model did not answer.");
  const text = provider === "claude"
    ? (payload.content ?? []).map((block) => block.text || "").join("\n")
    : provider === "gemini"
      ? (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text || "").join("\n")
      : payload.choices?.[0]?.message?.content || "";
  const result = readJson(text);
  if (!result.title && result.tags.length === 0) throw new Error("The model did not return a title.");
  return result;
}
