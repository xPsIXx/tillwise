import { fitVisionImage, imageToCanvas, loadImage } from "./image";
import { extractionIsThin, readLabelOnDevice } from "./parse-local";
import { loadPpocr, parsePpocrText, ppocrReady, runPpocr } from "./ppocr";
import { fillFromMemory } from "./catalog";
import { lookupProduct, scanLabelPhoto, scanLabelPhotos, scanReceiptPhoto, scanReceiptPhotos } from "./server";
import { effectiveRead, loadScanSettings, visionProvider, type ReadMode } from "./settings";
import type { LabelExtraction, LlmProvider, ReceiptExtraction } from "./types";

export async function readLabelCapture(
  image: string,
  barcode: string | null,
  read?: ReadMode,
  opts?: { skipMemory?: boolean },
): Promise<LabelExtraction> {
  const cfg = loadScanSettings();
  const mode = effectiveRead({ ...cfg, read: read ?? cfg.read });
  if (mode === "ppocr") {
    const ok = ppocrReady() || (await loadPpocr());
    if (!ok) throw new Error("PP-OCRv6 did not load");
    const img = await loadImage(image);
    const canvas = imageToCanvas(img, 1280);
    const hit = await runPpocr(canvas, undefined, { reticle: false, feel: cfg.ppocrFeel });
    let data = parsePpocrText(hit.text, barcode);
    if (extractionIsThin(data) && !hit.text && !barcode) {
      throw new Error("PP-OCR found no product text");
    }
    if (opts?.skipMemory) return data;
    const mem = await lookupProduct({
      data: { barcode: data.barcode ?? barcode, name: data.name },
    }).catch(() => null);
    if (mem) data = fillFromMemory(data, mem);
    return data;
  }
  if (mode === "device") {
    const img = await loadImage(image);
    const data = await readLabelOnDevice(img, barcode);
    if (!data) throw new Error("Browser text found nothing on this photo");
    return opts?.skipMemory ? data : withMemory(data, barcode);
  }
  const visionImage = await fitVisionImage(image);
  const result = await scanLabelPhoto({
    data: {
      imageDataUrl: visionImage,
      barcodeHint: barcode,
      detail: cfg.visionDetail,
      provider: mode === "byok" || mode === "grok" ? "byok" : "local",
    },
  });
  if (!result.ok) throw new Error(result.error);
  const data = result.data;
  if (barcode && !data.barcode) data.barcode = barcode;
  return opts?.skipMemory ? data : withMemory(data, barcode);
}

async function withMemory(data: LabelExtraction, barcode: string | null): Promise<LabelExtraction> {
  const mem = await lookupProduct({
    data: { barcode: data.barcode ?? barcode, name: data.name },
  }).catch(() => null);
  return mem ? fillFromMemory(data, mem) : data;
}

export async function readReceiptCapture(
  image: string,
  provider?: LlmProvider,
): Promise<ReceiptExtraction> {
  const cfg = loadScanSettings();
  const visionImage = await fitVisionImage(image);
  const result = await scanReceiptPhoto({
    data: {
      imageDataUrl: visionImage,
      detail: cfg.visionDetail,
      provider: provider ?? visionProvider(cfg),
    },
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export type BatchRead<T> = { ok: true; data: T } | { ok: false; error: string };

function chunkBySize<T extends { chars: number }>(
  items: T[],
  maxCount: number,
  maxChars: number,
): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const item of items) {
    if (cur.length && (cur.length >= maxCount || chars + item.chars > maxChars)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(item);
    chars += item.chars;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export async function readLabelCaptureBatch(
  photos: { image: string; barcode: string | null }[],
): Promise<{ results: BatchRead<LabelExtraction>[]; calls: number }> {
  if (photos.length === 0) return { results: [], calls: 0 };
  const cfg = loadScanSettings();
  const prepared = await Promise.all(
    photos.map(async (p) => {
      const imageDataUrl = await fitVisionImage(p.image, 750_000);
      return { imageDataUrl, barcodeHint: p.barcode, chars: imageDataUrl.length };
    }),
  );
  const chunks = chunkBySize(prepared, 8, 5_500_000);
  const results: BatchRead<LabelExtraction>[] = [];
  let calls = 0;
  for (const chunk of chunks) {
    calls += 1;
    try {
      const batch = await scanLabelPhotos({
        data: {
          photos: chunk.map(({ imageDataUrl, barcodeHint }) => ({ imageDataUrl, barcodeHint })),
          detail: cfg.visionDetail,
          provider: "byok",
        },
      });
      results.push(...batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read labels";
      results.push(...chunk.map(() => ({ ok: false as const, error: message })));
    }
  }
  return { results, calls };
}

export async function readReceiptCaptureBatch(
  images: string[],
): Promise<{ results: BatchRead<ReceiptExtraction>[]; calls: number }> {
  if (images.length === 0) return { results: [], calls: 0 };
  const cfg = loadScanSettings();
  const prepared = await Promise.all(
    images.map(async (image) => {
      const imageDataUrl = await fitVisionImage(image, 750_000);
      return { imageDataUrl, chars: imageDataUrl.length };
    }),
  );
  const chunks = chunkBySize(prepared, 4, 5_500_000);
  const results: BatchRead<ReceiptExtraction>[] = [];
  let calls = 0;
  for (const chunk of chunks) {
    calls += 1;
    try {
      const batch = await scanReceiptPhotos({
        data: {
          images: chunk.map((c) => c.imageDataUrl),
          detail: cfg.visionDetail,
          provider: "byok",
        },
      });
      results.push(...batch);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read till slips";
      results.push(...chunk.map(() => ({ ok: false as const, error: message })));
    }
  }
  return { results, calls };
}
