import { imageToCanvas, loadImage } from "./image";
import { extractionIsThin, readLabelOnDevice } from "./parse-local";
import { loadPpocr, parsePpocrText, ppocrReady, runPpocr } from "./ppocr";
import { scanLabelPhoto, scanReceiptPhoto } from "./server";
import { loadScanSettings, visionProvider, type ReadMode } from "./settings";
import type { LabelExtraction, LlmProvider, ReceiptExtraction } from "./types";

export async function readLabelCapture(
  image: string,
  barcode: string | null,
  read?: ReadMode,
): Promise<LabelExtraction> {
  const cfg = loadScanSettings();
  const mode = read ?? cfg.read;
  if (mode === "ppocr") {
    const ok = ppocrReady() || (await loadPpocr());
    if (!ok) throw new Error("PP-OCRv6 did not load");
    const img = await loadImage(image);
    const canvas = imageToCanvas(img, 960);
    const hit = await runPpocr(canvas, 0.15, { reticle: false });
    const data = parsePpocrText(hit.text, barcode);
    if (extractionIsThin(data) && !hit.text && !barcode) {
      throw new Error("PP-OCR found no product text");
    }
    return data;
  }
  if (mode === "device") {
    const img = await loadImage(image);
    const data = await readLabelOnDevice(img, barcode);
    if (!data) throw new Error("Browser text found nothing on this photo");
    return data;
  }
  const result = await scanLabelPhoto({
    data: {
      imageDataUrl: image,
      barcodeHint: barcode,
      detail: cfg.visionDetail,
      provider: mode === "grok" ? "grok" : "local",
    },
  });
  if (!result.ok) throw new Error(result.error);
  const data = result.data;
  if (barcode && !data.barcode) data.barcode = barcode;
  return data;
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
