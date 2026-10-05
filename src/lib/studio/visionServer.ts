export type VisionRequest = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  imageBase64?: string;
  mediaType?: string;
};

const PROMPT = 'Look at the image. Reply with JSON only, no markdown: {"title":"...","tags":["..."]}. The title is an artwork title: specific and a little imaginative, not a list of what is in the picture, at most 50 characters. Provide 20 to 30 tags. Join multi-word tags into one word with no space and no underscore, like darkfantasy. No # and no sentences. Cover subject, mood, style, colours, and setting.';

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/^#/, "").replace(/[\s_]+/g, "");
    if (tag && /^[\p{L}\p{N}_-]+$/u.test(tag) && tag.length <= 40) tags.push(tag);
  }
  return tags.slice(0, 30);
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

export async function runVision(input: VisionRequest): Promise<{ title: string; tags: string[] }> {
  const provider = input.provider || "";
  const model = (input.model || "").trim();
  const image = input.imageBase64 || "";
  const mediaType = input.mediaType || "image/jpeg";
  if (!model) throw new Error("Set a vision model in Settings.");
  if (!image) throw new Error("This file has no image to title.");
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
        generationConfig: { maxOutputTokens: 800, responseMimeType: "application/json" },
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
