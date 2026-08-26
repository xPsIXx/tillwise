import type { LabelExtraction, ProductMemory } from "./types";
import { extractionIsThin } from "./parse-local";

export function fillFromMemory(data: LabelExtraction, mem: ProductMemory): LabelExtraction {
  const thin = extractionIsThin(data);
  return {
    ...data,
    name: thin ? mem.name : data.name,
    brand: data.brand ?? mem.brand,
    category: data.category ?? mem.category,
    unitPrice: data.unitPrice ?? mem.lastUnitPrice,
    linePrice: data.linePrice ?? mem.lastLinePrice,
    weightValue: data.weightValue ?? mem.lastWeightValue,
    barcode: data.barcode ?? mem.barcode,
  };
}

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Collapse till abbreviations toward a stable product key. */
export function canonicalGuess(name: string): string {
  const key = nameKey(name);
  return key
    .replace(/\b(tom|toma)\b/g, "tomato")
    .replace(/\b(tomatoes|toms)\b/g, "tomato")
    .replace(/\b(vine)\b/g, "vine")
    .replace(/\b(org|organic)\b/g, "organic")
    .replace(/\b(pk|pack|pkt)\b/g, "")
    .replace(/\b(kg|g|lb|oz|ea|pcs|pc)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function perUnitPrice(
  unitPrice: number | null | undefined,
  linePrice: number | null | undefined,
  weightValue: number | null | undefined,
  quantity: number | null | undefined,
): number | null {
  if (unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0) return unitPrice;
  if (linePrice == null || !Number.isFinite(linePrice) || linePrice <= 0) return null;
  if (weightValue != null && weightValue > 0) return linePrice / weightValue;
  if (quantity != null && quantity > 0) return linePrice / quantity;
  return null;
}

export function parseReceiptDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime()) && direct.getFullYear() > 2000) {
    return direct.toISOString();
  }
  const m = trimmed.match(
    /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const day = a > 12 ? a : b > 12 ? b : a;
  const month = a > 12 ? b : a;
  const hour = m[4] ? Number(m[4]) : 12;
  const minute = m[5] ? Number(m[5]) : 0;
  const second = m[6] ? Number(m[6]) : 0;
  const parsed = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() < 2000) return null;
  return parsed.toISOString();
}
