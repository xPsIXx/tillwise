export type CropBox = { x0: number; y0: number; x1: number; y1: number };

export const LABEL_CAPTURE = { maxSide: 1600, quality: 0.88 } as const;
export const RECEIPT_CAPTURE = { maxSide: 2200, quality: 0.93 } as const;

export const LABEL_VIEWFINDER: CropBox = { x0: 0.04, y0: 0.1, x1: 0.96, y1: 0.86 };
export const RECEIPT_VIEWFINDER: CropBox = { x0: 0.06, y0: 0.06, x1: 0.94, y1: 0.9 };

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
  const scale = Math.min(1, maxWidth / Math.max(vw, vh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(vw * scale));
  canvas.height = Math.max(1, Math.round(vh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Crop the live video to a normalized 0..1 box (label region). */
export function cropVideo(
  video: HTMLVideoElement,
  box: CropBox,
  quality = LABEL_CAPTURE.quality,
  minSide = 1000,
): string {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  return cropSource(video, vw, vh, box, quality, minSide);
}

export function cropDataUrl(
  img: HTMLImageElement | HTMLCanvasElement,
  box: CropBox,
  quality = LABEL_CAPTURE.quality,
  minSide = 1000,
): string {
  const w = "naturalWidth" in img ? img.naturalWidth || img.width : img.width;
  const h = "naturalHeight" in img ? img.naturalHeight || img.height : img.height;
  return cropSource(img, w, h, box, quality, minSide);
}

function cropSource(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  box: CropBox,
  quality: number,
  minSide: number,
): string {
  const x0 = Math.max(0, Math.round(box.x0 * sw));
  const y0 = Math.max(0, Math.round(box.y0 * sh));
  const x1 = Math.min(sw, Math.round(box.x1 * sw));
  const y1 = Math.min(sh, Math.round(box.y1 * sh));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const scale = Math.max(1, minSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x0, y0, w, h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function padCrop(box: CropBox, pad = 0.08): CropBox {
  return {
    x0: Math.max(0, box.x0 - pad),
    y0: Math.max(0, box.y0 - pad),
    x1: Math.min(1, box.x1 + pad),
    y1: Math.min(1, box.y1 + pad),
  };
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
