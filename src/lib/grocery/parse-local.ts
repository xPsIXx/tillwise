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
  for (const line of raw.split(/\r?\n/)) {
    const digits = line.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) return digits;
  }
  // Do not let "14.95" glue onto the barcode line through the decimal point.
  const runs = raw.match(/(?<![.\d])\d[\d\s-]{6,16}\d(?![.\d])/g) ?? [];
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
  const push = (n: number | null) => {
    if (n != null && n > 0 && !out.some((x) => Math.abs(x - n) < 0.001)) out.push(n);
  };
  const labeled =
    /(?:AED|Dhs?|USD|£|\$|د\.?إ)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:AED|Dhs?)/gi;
  let m: RegExpExecArray | null;
  while ((m = labeled.exec(raw))) push(num(m[1] ?? m[2]));
  // Scale stickers (Lulu, Carrefour, …) print bare 12.50 next to UNIT PRICE / TOTAL.
  const bare = /(?<!\d)(\d{1,4}[.,]\d{2})(?!\d)/g;
  while ((m = bare.exec(raw))) {
    const n = num(m[1]);
    // Weights like 0.62 can look like money; keep only plausible prices.
    if (n != null && n >= 0.2) push(n);
  }
  return out;
}

function labeledNumber(raw: string, labels: RegExp): number | null {
  const m = raw.match(labels);
  return m ? num(m[1]) : null;
}

function parseLinePrice(raw: string, unitPrice: number | null): number | null {
  const labeled = labeledNumber(
    raw,
    /(?:total|net|amount|line)\s*(?:price)?\s*(?:AED|Dhs?|USD|£|\$|د\.?إ)?\s*(\d+(?:[.,]\d+)?)/i,
  );
  if (labeled != null) return labeled;
  const amounts = moneyAmounts(raw);
  const rest = unitPrice != null ? amounts.filter((n) => Math.abs(n - unitPrice) > 0.009) : amounts;
  if (rest.length) return rest[rest.length - 1];
  return amounts.length === 1 ? amounts[0] : null;
}

/** If weight × one price ≈ the other price, that pair is unit + line. */
function pairByWeight(
  weightValue: number | null,
  weightUnit: string | null,
  amounts: number[],
): { unitPrice: number; linePrice: number } | null {
  if (weightValue == null || weightValue <= 0 || amounts.length < 2) return null;
  const kg =
    (weightUnit ?? "kg").toLowerCase() === "g" ? weightValue / 1000 : weightValue;
  if (kg <= 0) return null;
  for (let i = 0; i < amounts.length; i += 1) {
    for (let j = 0; j < amounts.length; j += 1) {
      if (i === j) continue;
      const expected = roundMoney(amounts[i] * kg);
      if (Math.abs(expected - amounts[j]) <= Math.max(0.03, amounts[j] * 0.02)) {
        return { unitPrice: amounts[i], linePrice: amounts[j] };
      }
    }
  }
  return null;
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
  const flat = raw.replace(/[\r\n]+/g, " ");
  const weight =
    flat.match(
      /(?:weight|wt|net|الوزن)\s*(?:kg|g)?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)?/i,
    ) ??
    flat.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz|ml|l)\b/i) ??
    flat.match(/\b(kg|g)\s*(\d+(?:[.,]\d+)?)/i);
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
      weightUnit = (b ?? "kg").toLowerCase();
    }
  }

  const labeledUnit = labeledNumber(
    flat,
    /(?:unit\s*price|سعر\s*الوحدة|u\.?\s*p\.?)\s*(?:AED|Dhs?)?\s*(\d+(?:[.,]\d+)?)/i,
  );
  const unitHit = parseUnitPrice(flat);
  let unitPrice = labeledUnit ?? unitHit?.price ?? null;
  let linePrice = parseLinePrice(flat, unitPrice);

  const paired = pairByWeight(weightValue, weightUnit, moneyAmounts(flat));
  if (paired) {
    if (unitPrice == null) unitPrice = paired.unitPrice;
    if (linePrice == null || Math.abs(linePrice - unitPrice) < 0.001) {
      linePrice = paired.linePrice;
    }
    // Prefer the pair that matches the scale math when labels were ambiguous.
    if (Math.abs(paired.unitPrice - (unitPrice ?? 0)) > 0.05 && labeledUnit == null) {
      unitPrice = paired.unitPrice;
      linePrice = paired.linePrice;
    }
  }

  if (linePrice != null && unitPrice != null && Math.abs(linePrice - unitPrice) < 0.001) {
    const computed = perKgFromLine(linePrice, weightValue, weightUnit);
    if (computed && Math.abs(computed - unitPrice) > 0.05) {
      if (weightValue != null && weightValue !== 1) {
        linePrice = roundMoney(
          unitPrice *
            ((weightUnit ?? "").toLowerCase() === "g" ? weightValue / 1000 : weightValue),
        );
      }
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
    /^(AED|Dhs?|kg|g|oz|lb|total|qty|plu|org|organic|net|wt|weight|price|unit|lulu|carrefour|spinneys|waitrose|لو.?لو)$/i;
  const fieldish =
    /weight|unit\s*price|expiry|prod|packed|barcode|الوزن|سعر|تاريخ|الوحدة/i;
  const nameCandidates = lines.filter(
    (l) =>
      !skip.test(l) &&
      !fieldish.test(l) &&
      !/^\d+([.,]\d+)?(kg|g)?$/i.test(l) &&
      !/\d{8,}/.test(l.replace(/\s/g, "")) &&
      l.length > 2,
  );
  const nameLine =
    nameCandidates.find((l) => /[A-Za-z]{3,}/.test(l)) ??
    nameCandidates[0] ??
    (foundBarcode ? `Item ${foundBarcode}` : "Unknown item");

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

export function extractionConfidence(data: LabelExtraction, ocrScore?: number): number {
  let score = 0.15;
  if (
    data.name &&
    !/^unknown/i.test(data.name) &&
    !/^reading/i.test(data.name) &&
    !/^item\s+\d/i.test(data.name)
  ) {
    score += 0.2;
  }
  if (data.weightValue != null) score += 0.15;
  if (data.unitPrice != null) score += 0.15;
  if (data.linePrice != null) score += 0.15;
  if (data.barcode) score += 0.12;
  if (data.weightValue != null && data.unitPrice != null && data.linePrice != null && data.weightValue > 0) {
    const kg = (data.weightUnit ?? "kg").toLowerCase() === "g" ? data.weightValue / 1000 : data.weightValue;
    const expected = data.unitPrice * kg;
    if (Math.abs(expected - data.linePrice) <= Math.max(0.05, data.linePrice * 0.03)) score += 0.12;
  }
  if (ocrScore != null && Number.isFinite(ocrScore)) {
    score = score * 0.7 + Math.min(1, Math.max(0, ocrScore)) * 0.3;
  }
  return Math.round(Math.min(0.99, Math.max(0.05, score)) * 100) / 100;
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
