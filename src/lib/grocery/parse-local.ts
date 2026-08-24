import type { LabelExtraction } from "./types";

type TextDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string; raw_value?: string }>>;
};

let textDetector: TextDetectorLike | null | undefined;

function getTextDetector(): TextDetectorLike | null {
  if (textDetector !== undefined) return textDetector;
  const Ctor = (
    globalThis as unknown as {
      TextDetector?: new () => TextDetectorLike;
    }
  ).TextDetector;
  if (!Ctor) {
    textDetector = null;
    return textDetector;
  }
  try {
    textDetector = new Ctor();
  } catch {
    textDetector = null;
  }
  return textDetector;
}

export function deviceTextAvailable(): boolean {
  return Boolean(getTextDetector());
}

function joinText(parts: string[]): string {
  return parts
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parseFields(raw: string, barcode: string | null): LabelExtraction {
  const weight =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz|ml|l)\b/i) ??
    raw.match(/\b(kg|g)\s*(\d+(?:[.,]\d+)?)/i);
  let weightValue: number | null = null;
  let weightUnit: string | null = null;
  if (weight) {
    const a = weight[1];
    const b = weight[2];
    if (/^(kg|g|lb|oz|ml|l)$/i.test(a) && b) {
      weightValue = Number(b.replace(",", "."));
      weightUnit = a.toLowerCase();
    } else {
      weightValue = Number(a.replace(",", "."));
      weightUnit = b.toLowerCase();
    }
    if (!Number.isFinite(weightValue)) weightValue = null;
  }

  const price =
    raw.match(/(?:AED|Dhs?|د\.?إ)\s*(\d+(?:[.,]\d+)?)/i) ??
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:AED|Dhs?)/i);
  const linePrice = price ? Number(price[1].replace(",", ".")) : null;

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);
  const skip = /^(AED|Dhs?|kg|g|oz|lb|total|qty|plu|org|organic)$/i;
  const nameLine =
    lines.find((l) => !skip.test(l) && !/^\d+([.,]\d+)?$/.test(l) && l.length > 2) ??
    (barcode ? `Item ${barcode}` : "Unknown item");

  return {
    name: nameLine.slice(0, 80),
    brand: null,
    description: null,
    barcode,
    category: null,
    quantity: 1,
    quantityUnit: "ea",
    weightValue,
    weightUnit,
    unitPrice: null,
    linePrice: Number.isFinite(linePrice) ? linePrice : null,
    currency: linePrice != null ? "AED" : null,
    origin: null,
    rawText: raw,
  };
}

export function extractionIsThin(data: LabelExtraction): boolean {
  const unknown = !data.name || /^unknown/i.test(data.name) || /^item\s+\d/i.test(data.name);
  return unknown && data.weightValue == null && data.linePrice == null;
}

export async function readLabelOnDevice(
  source: ImageBitmapSource,
  barcode: string | null,
): Promise<LabelExtraction | null> {
  const det = getTextDetector();
  let raw = "";
  if (det) {
    try {
      const blocks = await det.detect(source);
      raw = joinText(
        blocks.map((b) => b.rawValue ?? b.raw_value ?? "").filter(Boolean),
      );
    } catch {
      raw = "";
    }
  }
  if (!raw && !barcode) return null;
  return parseFields(raw, barcode);
}
