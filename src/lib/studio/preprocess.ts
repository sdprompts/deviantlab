const ACCEPT = new Set(["png", "jpg", "jpeg", "bmp", "gif"]);

export function acceptedFile(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return ACCEPT.has(extension);
}

export function jpegWithCredit(jpeg: Uint8Array, credit: string): Uint8Array {
  if (!credit || jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const text = new TextEncoder().encode(`${credit}\0`);
  const tiff = 8 + 2 + 12 + 4 + text.length;
  const segment = new Uint8Array(2 + 2 + 6 + tiff);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  const length = segment.length - 2;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(new TextEncoder().encode("Exif\0\0"), 4);
  const tiffAt = 10;
  segment[tiffAt] = 0x49;
  segment[tiffAt + 1] = 0x49;
  segment[tiffAt + 2] = 0x2a;
  segment[tiffAt + 4] = 8;
  const ifd = tiffAt + 8;
  segment[ifd] = 1;
  segment[ifd + 2] = 0x0e;
  segment[ifd + 3] = 0x01;
  segment[ifd + 4] = 2;
  segment[ifd + 8] = text.length & 0xff;
  segment[ifd + 9] = (text.length >> 8) & 0xff;
  const valueAt = 26;
  segment[ifd + 12] = valueAt & 0xff;
  segment[ifd + 13] = (valueAt >> 8) & 0xff;
  segment.set(text, tiffAt + valueAt);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Could not encode this image.");
  return blob;
}

async function drawContain(source: CanvasImageSource, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare this image.");
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

export async function prepareUpload(
  file: File,
  watermarkUrl: string,
  credit: string,
): Promise<{ upload: Blob; vision: Blob; thumb: string }> {
  const bitmap = await createImageBitmap(file);
  const visionScale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const visionCanvas = await drawContain(bitmap, Math.max(1, Math.round(bitmap.width * visionScale)), Math.max(1, Math.round(bitmap.height * visionScale)));
  const vision = await canvasBlob(visionCanvas, 0.8);

  const uploadCanvas = await drawContain(bitmap, bitmap.width, bitmap.height);
  const context = uploadCanvas.getContext("2d");
  if (!context) throw new Error("Could not prepare this image.");
  if (watermarkUrl) {
    const mark = await createImageBitmap(await (await fetch(watermarkUrl)).blob());
    const width = Math.min(400, uploadCanvas.width);
    const height = Math.max(1, Math.round(mark.height * (width / mark.width)));
    const margin = 12;
    context.drawImage(mark, uploadCanvas.width - width - margin, uploadCanvas.height - height - margin, width, height);
    mark.close();
  }
  bitmap.close();
  const encoded = new Uint8Array(await (await canvasBlob(uploadCanvas, 0.95)).arrayBuffer());
  const marked = jpegWithCredit(encoded, credit);
  const copy = new ArrayBuffer(marked.byteLength);
  new Uint8Array(copy).set(marked);
  const upload = new Blob([copy], { type: "image/jpeg" });

  const thumbScale = Math.min(1, 240 / Math.max(uploadCanvas.width, uploadCanvas.height));
  const thumbCanvas = await drawContain(
    uploadCanvas,
    Math.max(1, Math.round(uploadCanvas.width * thumbScale)),
    Math.max(1, Math.round(uploadCanvas.height * thumbScale)),
  );
  const thumb = thumbCanvas.toDataURL("image/jpeg", 0.7);
  return { upload, vision, thumb };
}
