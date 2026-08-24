export async function blobToDataUrl(
  blob: Blob,
  maxWidth = 1280,
  quality = 0.72,
): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / Math.max(bitmap.width, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export async function makeThumbnail(dataUrl: string, maxWidth = 240): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.55);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

export async function publicImageToDataUrl(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error("Could not load sample photo");
  const blob = await res.blob();
  return blobToDataUrl(blob, 960, 0.7);
}

export function captureCanvas(
  video: HTMLVideoElement,
  maxWidth = 1280,
  quality = 0.72,
): string {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / vw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export type CropBox = { x0: number; y0: number; x1: number; y1: number };

/** Crop the live video to a normalized 0..1 box (PP-OCR label region). */
export function cropVideo(
  video: HTMLVideoElement,
  box: CropBox,
  quality = 0.82,
): string {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const x0 = Math.max(0, Math.round(box.x0 * vw));
  const y0 = Math.max(0, Math.round(box.y0 * vh));
  const x1 = Math.min(vw, Math.round(box.x1 * vw));
  const y1 = Math.min(vh, Math.round(box.y1 * vh));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(video, x0, y0, w, h, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export function imageToCanvas(img: HTMLImageElement, maxSide = 960): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
