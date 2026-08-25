import type { LabelExtraction } from "./types";
import type { EngineProgress } from "./tfjs";

const LOCAL_DET = "/models/PP-OCRv6_small_det.tar";
const LOCAL_REC = "/models/PP-OCRv6_small_rec.tar";
const ENGINE_JS = "/ppocr/paddleocr.bundle.js";
const ORT_WASM = "/ort/";
const CACHE_NAME = "tillwise-ppocr-v6-small-2";

const HF = {
  det: {
    name: "PP-OCRv6_small_det",
    cacheKey: "https://tillwise.local/models/PP-OCRv6_small_det.tar",
    localPath: LOCAL_DET,
    onnxKind: "det-onnx",
    ymlKind: "det-yml",
  },
  rec: {
    name: "PP-OCRv6_small_rec",
    cacheKey: "https://tillwise.local/models/PP-OCRv6_small_rec.tar",
    localPath: LOCAL_REC,
    onnxKind: "rec-onnx",
    ymlKind: "rec-yml",
  },
} as const;

type Kind = keyof typeof HF;

type OcrItem = {
  text?: string;
  score?: number;
  rec_score?: number;
  det_score?: number;
  box?: number[] | number[][];
};

type OcrResult = { items?: OcrItem[] } | { items?: OcrItem[] }[];

type PaddleInstance = {
  predict: (input: Blob | HTMLCanvasElement) => Promise<OcrResult>;
};

type PaddleCtor = {
  create: (opts: Record<string, unknown>) => Promise<PaddleInstance>;
};

declare global {
  interface Window {
    PaddleOCRJS?: { PaddleOCR?: PaddleCtor };
    PaddleOCR?: { PaddleOCR?: PaddleCtor };
    ort?: { env?: { wasm?: { numThreads?: number; proxy?: boolean } } };
  }
}

let instance: PaddleInstance | null = null;
let loading: Promise<boolean> | null = null;
let lastError: string | null = null;
const progressListeners = new Set<(p: EngineProgress) => void>();

function emitProgress(p: EngineProgress) {
  for (const fn of progressListeners) {
    try {
      fn(p);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export type PpocrHit = {
  ready: boolean;
  score: number;
  text: string;
  crop: { x0: number; y0: number; x1: number; y1: number } | null;
};

export function ppocrReady(): boolean {
  return Boolean(instance);
}

export function ppocrLastError(): string | null {
  return lastError;
}

function encodeOctal(n: number, width: number): string {
  return n.toString(8).padStart(width, "0");
}

function writeStr(buf: Uint8Array, offset: number, value: string, length: number) {
  for (let i = 0; i < length; i += 1) {
    buf[offset + i] = i < value.length ? value.charCodeAt(i) & 0xff : 0;
  }
}

/** Uncompressed ustar with inference.onnx + inference.yml — what paddleocr-js expects. */
function packUstar(files: { name: string; data: Uint8Array }[]): Blob {
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    const header = new Uint8Array(512);
    writeStr(header, 0, file.name, 100);
    writeStr(header, 100, "0000644", 8);
    writeStr(header, 108, "0000000", 8);
    writeStr(header, 116, "0000000", 8);
    writeStr(header, 124, `${encodeOctal(file.data.length, 11)}\0`, 12);
    writeStr(header, 136, `${encodeOctal(Math.floor(Date.now() / 1000), 11)}\0`, 12);
    writeStr(header, 148, "        ", 8);
    header[156] = 48; // '0' regular file
    writeStr(header, 257, "ustar", 6);
    writeStr(header, 263, "00", 2);
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    writeStr(header, 148, `${encodeOctal(sum, 6)}\0 `, 8);
    chunks.push(header);
    chunks.push(file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad) chunks.push(new Uint8Array(pad));
  }
  chunks.push(new Uint8Array(1024));
  return new Blob(chunks as BlobPart[], { type: "application/x-tar" });
}

async function fetchBytes(
  url: string,
  onChunk?: (got: number, total: number | null) => void,
): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || null;
  if (!res.body || !onChunk) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk?.(buf.length, total ?? buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onChunk(got, total);
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function localTarExists(path: string): Promise<boolean> {
  try {
    const res = await fetch(path, { method: "GET", headers: { Range: "bytes=0-16" } });
    if (!(res.ok || res.status === 206)) return false;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) return false;
    return true;
  } catch {
    return false;
  }
}

async function tarFromCache(kind: Kind): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(HF[kind].cacheKey);
    if (!hit || !hit.ok) return null;
    const blob = await hit.blob();
    if (blob.size < 1024) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function saveTar(kind: Kind, blob: Blob) {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      HF[kind].cacheKey,
      new Response(blob, { headers: { "Content-Type": "application/x-tar" } }),
    );
  } catch {
    /* private mode / quota */
  }
}

function hfProxy(kind: string): string {
  return `/api/ppocr/hf?kind=${encodeURIComponent(kind)}`;
}

async function downloadAndPack(
  kind: Kind,
  onProgress?: (p: EngineProgress) => void,
): Promise<string> {
  const spec = HF[kind];
  const label = kind === "det" ? "detection" : "recognition";
  const base = kind === "det" ? 18 : 48;
  onProgress?.({ label: `Downloading ${label} model from Hugging Face…`, pct: base });
  const onnx = await fetchBytes(hfProxy(spec.onnxKind), (got, total) => {
    const frac = total ? got / total : 0.5;
    onProgress?.({
      label: `Downloading ${label} model ${total ? `${Math.round(frac * 100)}%` : "…"}`,
      pct: base + Math.round(frac * 18),
    });
  });
  const yml = await fetchBytes(hfProxy(spec.ymlKind));
  onProgress?.({ label: `Packing ${label} model…`, pct: base + 20 });
  const tar = packUstar([
    { name: "inference.onnx", data: onnx },
    { name: "inference.yml", data: yml },
  ]);
  await saveTar(kind, tar);
  return URL.createObjectURL(tar);
}

async function fetchLocalTar(
  kind: Kind,
  onProgress?: (p: EngineProgress) => void,
): Promise<string> {
  const spec = HF[kind];
  const label = kind === "det" ? "detection" : "recognition";
  const base = kind === "det" ? 18 : 48;
  const bytes = await fetchBytes(spec.localPath, (got, total) => {
    const frac = total ? got / total : 0.5;
    onProgress?.({
      label: `Loading ${label} model ${total ? `${Math.round(frac * 100)}%` : "…"}`,
      pct: base + Math.round(frac * 18),
    });
  });
  const blob = new Blob([bytes as BlobPart], { type: "application/x-tar" });
  await saveTar(kind, blob);
  return URL.createObjectURL(blob);
}

async function resolveTar(
  kind: Kind,
  onProgress?: (p: EngineProgress) => void,
): Promise<string> {
  const cached = await tarFromCache(kind);
  if (cached) return cached;
  if (await localTarExists(HF[kind].localPath)) {
    return fetchLocalTar(kind, onProgress);
  }
  return downloadAndPack(kind, onProgress);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PaddleOCRJS?.PaddleOCR || window.PaddleOCR?.PaddleOCR) {
      resolve();
      return;
    }
    const existing = document.querySelector("script[data-tillwise-ppocr]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("PP-OCR engine failed to load")),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.tillwisePpocr = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("PP-OCR engine failed to load"));
    document.head.appendChild(s);
  });
}

function paddleCtor(): PaddleCtor | null {
  return window.PaddleOCRJS?.PaddleOCR ?? window.PaddleOCR?.PaddleOCR ?? null;
}

export async function loadPpocr(onProgress?: (p: EngineProgress) => void): Promise<boolean> {
  if (onProgress) progressListeners.add(onProgress);
  if (instance) {
    onProgress?.({ label: "PP-OCRv6 ready", pct: 100 });
    return true;
  }
  if (loading) return loading;
  lastError = null;
  loading = (async () => {
    try {
      emitProgress({ label: "Loading PP-OCR engine…", pct: 6 });
      await loadScript(ENGINE_JS);
      const PaddleOCR = paddleCtor();
      if (!PaddleOCR) throw new Error("PP-OCR engine missing after load");

      emitProgress({ label: "Resolving PP-OCRv6 models…", pct: 16 });
      const detUrl = await resolveTar("det", emitProgress);
      const recUrl = await resolveTar("rec", emitProgress);

      emitProgress({ label: "Starting PP-OCRv6 (compiling WASM)…", pct: 82 });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 60);
      });
      const started = Date.now();
      const beat = window.setInterval(() => {
        const s = Math.round((Date.now() - started) / 1000);
        emitProgress({
          label: `Starting PP-OCRv6 (compiling WASM, ${s}s)…`,
          pct: Math.min(96, 82 + Math.min(s, 14)),
        });
      }, 1000);
      try {
        if (window.ort?.env?.wasm) {
          window.ort.env.wasm.numThreads = 1;
          window.ort.env.wasm.proxy = false;
        }
        console.info("[ppocr] create", {
          isolated: self.crossOriginIsolated,
          sab: typeof SharedArrayBuffer !== "undefined",
        });
        const created = PaddleOCR.create({
          worker: false,
          textDetectionModelName: HF.det.name,
          textDetectionModelAsset: { url: detUrl },
          textRecognitionModelName: HF.rec.name,
          textRecognitionModelAsset: { url: recUrl },
          ortOptions: {
            backend: "wasm",
            wasmPaths: ORT_WASM,
            numThreads: 1,
            simd: true,
            proxy: false,
            disableWasmProxy: true,
          },
        });
        const timed = new Promise<never>((_, reject) => {
          window.setTimeout(
            () => reject(new Error("PP-OCR start timed out. Try again, or use shape detect.")),
            180000,
          );
        });
        instance = await Promise.race([created, timed]);
      } finally {
        window.clearInterval(beat);
      }
      emitProgress({ label: "PP-OCRv6 ready", pct: 100 });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "PP-OCRv6 failed to load";
      lastError = message;
      console.error("[ppocr]", err);
      emitProgress({ label: message, pct: 0, error: true });
      instance = null;
      loading = null;
      return false;
    }
  })();
  return loading;
}

function normalizeBox(
  box: OcrItem["box"],
  w: number,
  h: number,
): [number, number, number, number] | null {
  if (!box) return null;
  const pts = Array.isArray(box[0]) ? (box as number[][]) : null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  if (pts) {
    for (const p of pts) {
      const x = p[0] > 1.5 ? p[0] / w : p[0];
      const y = p[1] > 1.5 ? p[1] / h : p[1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  } else {
    const b = box as number[];
    if (b.length < 4) return null;
    minX = b[0] > 1.5 ? b[0] / w : b[0];
    minY = b[1] > 1.5 ? b[1] / h : b[1];
    maxX = b[0] + b[2] > 1.5 ? (b[0] + b[2]) / w : b[0] + b[2];
    maxY = b[1] + b[3] > 1.5 ? (b[1] + b[3]) / h : b[1] + b[3];
  }
  if (minX > maxX || minY > maxY) return null;
  return [minX, minY, maxX - minX, maxY - minY];
}

export async function runPpocr(
  canvas: HTMLCanvasElement,
  threshold: number,
  opts?: { reticle?: boolean },
): Promise<PpocrHit> {
  if (!instance) {
    return { ready: false, score: 0, text: "", crop: null };
  }
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.85),
  );
  if (!blob) return { ready: false, score: 0, text: "", crop: null };
  let ocrRes: OcrResult;
  try {
    ocrRes = await instance.predict(blob);
  } catch {
    return { ready: false, score: 0, text: "", crop: null };
  }
  const first = Array.isArray(ocrRes) ? ocrRes[0] : ocrRes;
  const items = first && Array.isArray(first.items) ? first.items : [];
  const w = canvas.width;
  const h = canvas.height;
  const useReticle = opts?.reticle !== false;
  const rx0 = 0.3;
  const ry0 = 0.3;
  const rx1 = 0.7;
  const ry1 = 0.7;
  const labelLike = items.filter((it) => {
    const b = normalizeBox(it.box, w, h);
    if (!b) return false;
    const cx = b[0] + b[2] / 2;
    const cy = b[1] + b[3] / 2;
    if (useReticle && !(cx > rx0 && cx < rx1 && cy > ry0 && cy < ry1)) return false;
    const text = it.text || "";
    if (text.length < 2) return false;
    if (!/[A-Za-z0-9]/.test(text)) return false;
    if (b[2] > 0 && b[3] / b[2] > 1.6) return false;
    return true;
  });
  if (!labelLike.length) return { ready: false, score: 0, text: "", crop: null };
  labelLike.sort(
    (a, b) => (b.score || b.rec_score || 0) - (a.score || a.rec_score || 0),
  );
  const best = labelLike[0];
  const score = best.score || best.rec_score || 0;
  const text = labelLike
    .map((it) => (it.text || "").trim())
    .filter(Boolean)
    .join(" ");
  let crop: PpocrHit["crop"] = null;
  const bb = normalizeBox(best.box, w, h);
  if (bb) {
    const pad = 0.08;
    crop = {
      x0: Math.max(0, bb[0] - pad),
      y0: Math.max(0, bb[1] - pad),
      x1: Math.min(1, bb[0] + bb[2] + pad),
      y1: Math.min(1, bb[1] + bb[3] + pad),
    };
  }
  return { ready: score >= threshold, score, text, crop };
}

export function parsePpocrText(text: string, barcode: string | null): LabelExtraction {
  const price =
    text.match(/(?:AED|Dhs?|DH)\s*(\d{1,3}(?:[.,]\d{2}))/i) ??
    text.match(/(\d{1,3}(?:[.,]\d{2}))\s*(?:AED|Dhs?)/i);
  const weight = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|lb|oz)\b/i);
  const cleaned = text
    .replace(/(?:AED|Dhs?|DH)\s*\d{1,3}(?:[.,]\d{2})?/gi, " ")
    .replace(/\d{1,3}(?:[.,]\d{2})\s*(?:AED|Dhs?)?/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(kg|l|ml|g|lb|oz)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return {
    name: (cleaned || barcode || "Unknown item").slice(0, 80),
    brand: null,
    description: null,
    barcode,
    category: null,
    quantity: 1,
    quantityUnit: "ea",
    weightValue: weight ? Number(weight[1].replace(",", ".")) : null,
    weightUnit: weight ? weight[2].toLowerCase() : null,
    unitPrice: null,
    linePrice: price ? Number(price[1].replace(",", ".")) : null,
    currency: price ? "AED" : null,
    origin: null,
    rawText: text,
  };
}
