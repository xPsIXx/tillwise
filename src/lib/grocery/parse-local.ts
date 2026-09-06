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
  const candidates: string[] = [];
  const push = (digits: string) => {
    if (digits.length >= 8 && digits.length <= 14 && !candidates.includes(digits)) {
      candidates.push(digits);
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    // 0.788 and 12.95 must not concatenate into a fake code.
    const withoutMoney = line.replace(/\d+[.,]\d+/g, " ");
    push(withoutMoney.replace(/\D/g, ""));
    for (const run of withoutMoney.match(/\d[\d\s-]{6,16}\d/g) ?? []) {
      push(run.replace(/\D/g, ""));
    }
  }
  const runs = raw.match(/(?<![.\d])\d[\d\s-]{6,16}\d(?![.\d])/g) ?? [];
  for (const run of runs) push(run.replace(/\D/g, ""));
  return (
    candidates.find((d) => d.length === 13) ??
    candidates.find((d) => d.length === 12) ??
    candidates.find((d) => d.length === 8) ??
    candidates[0] ??
    null
  );
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

type ScaleCluster = {
  weightValue: number;
  weightUnit: string;
  unitPrice: number;
  linePrice: number;
  at: number;
};

function findWeights(raw: string): { value: number; unit: string; at: number }[] {
  const out: { value: number; unit: string; at: number }[] = [];
  const re =
    /(?:weight|wt|net|الوزن)?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)\b|\b(kg|g)\s*(\d+(?:[.,]\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[3] && m[4]) {
      const value = num(m[4]);
      if (value != null && value > 0 && value < 50) {
        out.push({ value, unit: m[3].toLowerCase(), at: m.index });
      }
    } else {
      const value = num(m[1]);
      if (value != null && value > 0 && value < 50) {
        out.push({ value, unit: (m[2] ?? "kg").toLowerCase(), at: m.index });
      }
    }
  }
  return out;
}

function pickScaleCluster(raw: string): ScaleCluster | null {
  const weights = findWeights(raw);
  const amounts = moneyAmounts(raw);
  const clusters: ScaleCluster[] = [];
  for (const w of weights) {
    const kg = w.unit === "g" ? w.value / 1000 : w.value;
    if (kg <= 0) continue;
    for (let i = 0; i < amounts.length; i += 1) {
      for (let j = 0; j < amounts.length; j += 1) {
        if (i === j) continue;
        const expected = roundMoney(amounts[i] * kg);
        if (Math.abs(expected - amounts[j]) <= Math.max(0.04, amounts[j] * 0.025)) {
          clusters.push({
            weightValue: w.value,
            weightUnit: w.unit,
            unitPrice: amounts[i],
            linePrice: amounts[j],
            at: w.at,
          });
        }
      }
    }
  }
  if (!clusters.length) return null;
  const nameHits: number[] = [];
  const nameRe = /\b[A-Z][a-z]{3,}\b/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(raw))) nameHits.push(nm.index);
  const scored = clusters.map((c) => {
    const nearName = nameHits.length
      ? Math.min(...nameHits.map((i) => Math.abs(i - c.at)))
      : 10_000;
    return { c, nearName };
  });
  scored.sort((a, b) => a.nearName - b.nearName || b.c.linePrice - a.c.linePrice);
  return scored[0].c;
}

const FIELD_TOKEN =
  /^(weight|unit|price|expiry|date|prod|packed|on|barcode|scale|total|amount|item|net|wt|qty|plu|id|aed|dhs|dirham|hyper|hypermarket|mart|llc|the)$/i;

const FIELD_LINE =
  /weight|unit\s*price|expiry|prod\/?packed|barcode|الوزن|سعر|تاريخ|الوحدة|packed\s*on|dirham/i;

const STORE_NAMES = [
  "lulu",
  "carrefour",
  "spinneys",
  "waitrose",
  "nesto",
  "choithram",
  "choithrams",
  "unioncoop",
  "almaya",
  "luluhyper",
  "luluhypermarket",
];

const PRODUCE_HINT =
  /^(capsicum|pepper|peppers|carrot|carrots|onion|onions|tomato|tomatoes|potato|potatoes|apple|apples|banana|bananas|lettuce|cucumber|cauliflower|broccoli|grape|grapes|mango|mangoes|orange|oranges|lemon|lemons|lime|limes|garlic|ginger|cabbage|spinach|melon|watermelon|chicken|beef|lamb|milk|yogurt|yoghurt|cheese|bread|rice|beans|peas|corn|chilli|chili|pakchoi|pakchoy)$/i;

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cur = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
    }
  }
  return dp[n];
}

function foldToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z]/g, "");
}

export function isStoreToken(w: string): boolean {
  const s = foldToken(w);
  if (s.length < 3) return false;
  if (STORE_NAMES.some((st) => s === st || (s.length >= 4 && st.startsWith(s)))) return true;
  if (s.length >= 3 && s.length <= 6 && editDistance(s, "lulu") <= 2) return true;
  if (s.length >= 6 && s.length <= 12 && editDistance(s, "carrefour") <= 3) return true;
  return false;
}

export function nameLooksWeak(name: string): boolean {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  if (words.length === 1 && (isStoreToken(words[0]) || /[a-z][A-Z]/.test(words[0]))) return true;
  if (words.length === 1 && words[0].length < 5 && !PRODUCE_HINT.test(words[0])) return true;
  return words.every((w) => isStoreToken(w) || FIELD_TOKEN.test(w));
}

function wordScore(w: string): number {
  if (FIELD_TOKEN.test(w) || isStoreToken(w)) return -1;
  if (!/^[A-Za-z][A-Za-z']+$/.test(w)) return -1;
  if (!/[aeiouy]/i.test(w)) return -1;
  if (w.length < 3) return -1;
  if (/[a-z][A-Z]/.test(w)) return -1;
  let score = 0;
  if (w.length >= 6) score += 3;
  else if (w.length >= 5) score += 2;
  else if (w.length >= 4) score += 1;
  else score -= 1;
  if (/^[A-Z][a-z]+$/.test(w)) score += 2;
  else if (/^[A-Z]{4,}$/.test(w)) score += 1;
  else if (/^[a-z]+$/.test(w) && w.length < 5) score -= 1;
  if (PRODUCE_HINT.test(w)) score += 4;
  return score;
}

function scorePhrase(words: string[]): number {
  const scores = words.map(wordScore);
  if (scores.some((s) => s < 0)) return -1;
  const sum = scores.reduce((a, b) => a + b, 0);
  const bonus = words.length >= 2 ? 4 : words[0] && words[0].length >= 8 ? 2 : 0;
  return sum + bonus;
}

/** Prefer the printed produce line over the store logo and field labels. */
export function pickProductName(raw: string, foundBarcode: string | null): string {
  const words = [...raw.matchAll(/[A-Za-z][A-Za-z']{1,}/g)].map((m) => m[0]);
  let best = { score: 0, phrase: "" };
  for (let i = 0; i < words.length; i += 1) {
    for (let len = 1; len <= 4 && i + len <= words.length; len += 1) {
      const slice = words.slice(i, i + len);
      const score = scorePhrase(slice);
      if (score > best.score) best = { score, phrase: slice.join(" ") };
    }
  }
  if (best.phrase && best.score >= 3) return best.phrase.slice(0, 80);

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
  for (const line of lines) {
    if (FIELD_LINE.test(line) || /^\d+([.,]\d+)?(kg|g)?$/i.test(line)) continue;
    if (/\d{8,}/.test(line.replace(/\s/g, ""))) continue;
    const lineWords = [...line.matchAll(/\b[A-Za-z][A-Za-z']{2,}\b/g)]
      .map((m) => m[0])
      .filter((w) => wordScore(w) >= 0);
    if (lineWords.length === 0) continue;
    const phrase = lineWords.slice(0, 4).join(" ");
    if (phrase.length >= 3 && !nameLooksWeak(phrase)) return phrase.slice(0, 80);
  }

  if (best.phrase.length >= 3) return best.phrase.slice(0, 80);
  return foundBarcode ? `Item ${foundBarcode}` : "Unknown item";
}


export function parseLabelText(raw: string, barcode: string | null): LabelExtraction {
  const flat = raw.replace(/[\r\n]+/g, " ");
  const cluster = pickScaleCluster(flat);

  let weightValue: number | null = cluster?.weightValue ?? null;
  let weightUnit: string | null = cluster?.weightUnit ?? null;
  if (weightValue == null) {
    const weight =
      flat.match(
        /(?:weight|wt|net|الوزن)\s*(?:kg|g)?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)?/i,
      ) ??
      flat.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz|ml|l)\b/i) ??
      flat.match(/\b(kg|g)\s*(\d+(?:[.,]\d+)?)/i);
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
  }

  const labeledUnit = labeledNumber(
    flat,
    /(?:unit\s*price|سعر\s*الوحدة|u\.?\s*p\.?)\s*(?:AED|Dhs?)?\s*(\d+(?:[.,]\d+)?)/i,
  );
  const unitHit = parseUnitPrice(flat);
  let unitPrice = cluster?.unitPrice ?? labeledUnit ?? unitHit?.price ?? null;
  let linePrice = cluster?.linePrice ?? parseLinePrice(flat, unitPrice);

  if (!cluster) {
    const paired = pairByWeight(weightValue, weightUnit, moneyAmounts(flat));
    if (paired) {
      if (unitPrice == null) unitPrice = paired.unitPrice;
      if (linePrice == null || Math.abs(linePrice - unitPrice) < 0.001) {
        linePrice = paired.linePrice;
      }
      if (Math.abs(paired.unitPrice - (unitPrice ?? 0)) > 0.05 && labeledUnit == null) {
        unitPrice = paired.unitPrice;
        linePrice = paired.linePrice;
      }
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
  const nameLine = pickProductName(raw, foundBarcode);

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
    !/^item\s+\d/i.test(data.name) &&
    !nameLooksWeak(data.name)
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
