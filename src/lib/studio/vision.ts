import { readSettings } from "../settings";

export async function generateTitle(image: Blob): Promise<{ title: string; tags: string[] }> {
  const settings = readSettings();
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x2000));
  }
  const response = await fetch("/da-vision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: settings.visionProvider,
      model: settings.visionModel,
      baseUrl: settings.visionBaseUrl,
      apiKey: settings.visionKey,
      temperature: settings.visionTemperature,
      tagCount: settings.visionTagCount,
      instructions: settings.visionPrompt,
      imageBase64: btoa(binary),
      mediaType: image.type || "image/jpeg",
    }),
  });
  const payload = (await response.json()) as { title?: string; tags?: string[]; error_description?: string };
  if (!response.ok) throw new Error(payload.error_description || "Could not generate a title.");
  return {
    title: payload.title || "",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
  };
}
