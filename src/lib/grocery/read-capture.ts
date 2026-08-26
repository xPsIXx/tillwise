import { imageToCanvas, loadImage } from "./image";
import { extractionIsThin, readLabelOnDevice } from "./parse-local";
import { loadPpocr, parsePpocrText, ppocrReady, runPpocr } from "./ppocr";
import { fillFromMemory } from "./catalog";
import { lookupProduct, scanLabelPhoto, scanReceiptPhoto } from "./server";
import { effectiveRead, loadScanSettings, visionProvider, type ReadMode } from "./settings";
import type { LabelExtraction, LlmProvider, ReceiptExtraction } from "./types";

export async function readLabelCapture(
  image: string,
  barcode: string | null,
  read?: ReadMode,
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
    return withMemory(data, barcode);
  }
  const result = await scanLabelPhoto({
    data: {
      imageDataUrl: image,
      barcodeHint: barcode,
      detail: cfg.visionDetail,
      provider: mode === "byok" || mode === "grok" ? "byok" : "local",
    },
  });
  if (!result.ok) throw new Error(result.error);
  const data = result.data;
  if (barcode && !data.barcode) data.barcode = barcode;
  return withMemory(data, barcode);
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
  const result = await scanReceiptPhoto({
    data: {
      imageDataUrl: image,
      detail: cfg.visionDetail,
      provider: provider ?? visionProvider(cfg),
    },
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
