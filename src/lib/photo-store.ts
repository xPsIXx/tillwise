import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function dataRoot(): string {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return resolve("/data");
  }
  return resolve(process.cwd(), "data");
}

export function photosRoot(): string {
  return join(dataRoot(), "photos");
}

export function logsRoot(): string {
  return join(dataRoot(), "logs");
}

export function isDataUrl(value: string | null | undefined): boolean {
  return !!value && value.startsWith("data:");
}

export function isFileRef(value: string | null | undefined): boolean {
  return !!value && value.startsWith("file:");
}

export function asFileRef(incoming: string | null | undefined): string | null {
  if (!incoming) return null;
  if (incoming.startsWith("file:")) return incoming;
  const item = /\/media\/item\/(\d+)/.exec(incoming);
  if (item) return `file:items/${item[1]}.thumb.jpg`;
  const shot = /\/media\/shot\/(\d+)/.exec(incoming);
  if (shot) return `file:shots/${shot[1]}.thumb.jpg`;
  const rec = /\/media\/receipt\/(\d+)/.exec(incoming);
  if (rec) return `file:receipts/${rec[1]}.thumb.jpg`;
  return incoming;
}

function decodeDataUrl(data: string): Buffer {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(data);
  if (!m?.[2]) throw new Error("Photo is not a data URL");
  return Buffer.from(m[2], "base64");
}

function writeBytes(rel: string, buf: Buffer): string {
  const root = photosRoot();
  mkdirSync(root, { recursive: true });
  const folder = rel.split("/")[0];
  if (folder) mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, rel), buf);
  return `file:${rel}`;
}

export function writeShotImage(shotId: number, imageData: string): string {
  return writeBytes(`shots/${shotId}.jpg`, decodeDataUrl(imageData));
}

export function writeShotThumb(shotId: number, thumb: string): string {
  return writeBytes(`shots/${shotId}.thumb.jpg`, decodeDataUrl(thumb));
}

export function writeItemThumb(itemId: number, thumb: string): string {
  return writeBytes(`items/${itemId}.thumb.jpg`, decodeDataUrl(thumb));
}

export function writeReceiptThumb(captureId: number, thumb: string): string {
  return writeBytes(`receipts/${captureId}.thumb.jpg`, decodeDataUrl(thumb));
}

export function readFileRef(ref: string): Buffer | null {
  if (!isFileRef(ref)) return null;
  const rel = ref.slice("file:".length).replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("\\") || rel.includes("\0")) return null;
  const root = photosRoot();
  const abs = join(root, rel);
  if (!abs.startsWith(root)) return null;
  if (!existsSync(abs)) return null;
  return readFileSync(abs);
}

export function removeFileRef(ref: string | null | undefined) {
  if (!ref || !isFileRef(ref)) return;
  const rel = ref.slice("file:".length).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return;
  const abs = join(photosRoot(), rel);
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

export function bufferToDataUrl(buf: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export function shotThumbUrl(id: number): string {
  return `/media/shot/${id}/thumb`;
}

export function shotImageUrl(id: number): string {
  return `/media/shot/${id}`;
}

export function itemThumbUrl(id: number): string {
  return `/media/item/${id}/thumb`;
}

export function receiptThumbUrl(id: number): string {
  return `/media/receipt/${id}/thumb`;
}

export function resolveStoredImage(stored: string | null, fallbackUrl: string): string | null {
  if (!stored) return null;
  if (isFileRef(stored) || isDataUrl(stored)) return fallbackUrl;
  if (stored.startsWith("/media/")) return stored;
  return fallbackUrl;
}
