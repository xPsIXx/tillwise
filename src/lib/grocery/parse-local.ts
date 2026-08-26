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

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** 8–14 digit product codes; ignores weights like 500 or dates. */
export function extractBarcode(raw: string, given: string | null): string | null {
  const hint = given?.replace(/\D/g, "") ?? "";
  if (hint.length >= 8 && hint.length <= 14) return hint;
  const runs = raw.match(/\d[\d\s-]{6,20}\d/g) ?? [];
  for (const run of runs) {
    const digits = run.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) return digits;
  }
  return null;
}

type UnitHit = { price: number; perKg: boolean };

function parseUnitPrice(raw: string): UnitHit | null {
  const patterns: Array<{ re: RegExp; price: number; unit: number }> = [
    {
      re: /(?:AED|Dhs?|USD|£|\$|د\.?إ)?\s*(\d+(?:[.,]\d+)?)\s*(?:AED|Dhs?)?\s*(?:\/\s*|per\s+)(100\s*g|kg|g|lb|oz)\b/gi,
      price: 1,
      unit: 2,
    },
    {
      re: /(?:\/\s*|per\s+)(100\s*g|kg|g|lb|oz)\s*(?:AED|Dhs?|USD|£|\$)?\s*(\d+(?:[.,]\d+)?)/gi,
      price: 2,
      unit: 1,
    },
    {
      re: /(?:unit\s*price|price\s*\/\s*kg|per\s*kilo)\s*(?:AED|Dhs?)?\s*(\d+(?:[.,]\d+)?)/gi,
      price: 1,
      unit: 0,
    },
  ];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    const m = p.re.exec(raw);
    if (!m) continue;
    const price = num(m[p.price]);
    if (price == null || price <= 0) continue;
    const unit = (p.unit ? m[p.unit] : "kg")?.toLowerCase().replace(/\s+/g, "") ?? "kg";
    if (unit === "100g") return { price: price * 10, perKg: true };
    if (unit === "g") return { price: price * 1000, perKg: true };
    return { price, perKg: unit === "kg" };
  }
  return null;
}

function moneyAmounts(raw: string): number[] {
  const out: number[] = [];
  const re =
    /(?:AED|Dhs?|USD|£|\$|د\.?إ)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:AED|Dhs?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const n = num(m[1] ?? m[2]);
    if (n != null && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function parseLinePrice(raw: string, unitPrice: number | null): number | null {
  const labeled = raw.match(
    /(?:total|net|amount)\s*(?:AED|Dhs?|USD|£|\$|د\.?إ)?\s*(\d+(?:[.,]\d+)?)/i,
  );
  if (labeled) return num(labeled[1]);
  const amounts = moneyAmounts(raw);
  const rest = unitPrice != null ? amounts.filter((n) => Math.abs(n - unitPrice) > 0.009) : amounts;
  if (rest.length) return rest[rest.length - 1];
  return amounts.length === 1 ? amounts[0] : null;
}

function perKgFromLine(
  linePrice: number | null,
  weightValue: number | null,
  weightUnit: string | null,
): number | null {
  if (linePrice == null || linePrice <= 0 || weightValue == null || weightValue <= 0) {
    return null;
  }
  const u = (weightUnit ?? "").toLowerCase();
  if (u === "kg") return roundMoney(linePrice / weightValue);
  if (u === "g") return roundMoney(linePrice / (weightValue / 1000));
  if (u === "lb") return roundMoney(linePrice / weightValue);
  return null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseLabelText(raw: string, barcode: string | null): LabelExtraction {
  const weight =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz|ml|l)\b/i) ??
    raw.match(/\b(kg|g)\s*(\d+(?:[.,]\d+)?)/i);
  let weightValue: number | null = null;
  let weightUnit: string | null = null;
  if (weight) {
    const a = weight[1];
    const b = weight[2];
    if (/^(kg|g|lb|oz|ml|l)$/i.test(a) && b) {
      weightValue = num(b);
      weightUnit = a.toLowerCase();
    } else {
      weightValue = num(a);
      weightUnit = b.toLowerCase();
    }
  }

  const unitHit = parseUnitPrice(raw);
  let unitPrice = unitHit?.price ?? null;
  let linePrice = parseLinePrice(raw, unitPrice);

  if (linePrice != null && unitPrice != null && Math.abs(linePrice - unitPrice) < 0.001) {
    const computed = perKgFromLine(linePrice, weightValue, weightUnit);
    if (computed && Math.abs(computed - unitPrice) > 0.05) {
      // The lone "AED 4.25" was probably the unit rate, not the line total.
      if (weightValue != null && weightValue !== 1) linePrice = roundMoney(unitPrice * (
        (weightUnit ?? "").toLowerCase() === "g" ? weightValue / 1000 : weightValue
      ));
    }
  }

  if (unitPrice == null) {
    unitPrice = perKgFromLine(linePrice, weightValue, weightUnit);
  }

  const foundBarcode = extractBarcode(raw, barcode);

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 1);
  const skip =
    /^(AED|Dhs?|kg|g|oz|lb|total|qty|plu|org|organic|net|wt|weight|price|unit)$/i;
  const nameLine =
    lines.find(
      (l) =>
        !skip.test(l) &&
        !/^\d+([.,]\d+)?$/.test(l) &&
        !/\d{8,}/.test(l.replace(/\s/g, "")) &&
        l.length > 2,
    ) ?? (foundBarcode ? `Item ${foundBarcode}` : "Unknown item");

  return {
    name: nameLine.slice(0, 80),
    brand: null,
    description: null,
    barcode: foundBarcode,
    category: null,
    quantity: 1,
    quantityUnit: "ea",
    weightValue,
    weightUnit,
    unitPrice,
    linePrice,
    currency: linePrice != null || unitPrice != null ? "AED" : null,
    origin: null,
    rawText: raw,
  };
}

export function extractionIsThin(data: LabelExtraction): boolean {
  const unknown = !data.name || /^unknown/i.test(data.name) || /^item\s+\d/i.test(data.name);
  return unknown && data.weightValue == null && data.linePrice == null && data.unitPrice == null;
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
  return parseLabelText(raw, barcode);
}
