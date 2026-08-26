import { extractionConfidence } from "./parse-local";
import type { LabelExtraction, ReceiptExtraction, ScanShot } from "./types";

export type PhotoState = "pending" | "in-cart" | "read" | "failed";

export type PhotoTag = {
  state: PhotoState;
  label: string;
  confidence: number | null;
};

function isLabelRead(last: ScanShot["lastRead"]): last is LabelExtraction {
  return Boolean(last && "rawText" in last && "name" in last && !("items" in last));
}

function isReceiptRead(last: ScanShot["lastRead"]): last is ReceiptExtraction {
  return Boolean(last && "items" in last);
}

function isFailedRead(last: ScanShot["lastRead"]): boolean {
  if (!last) return false;
  if (isLabelRead(last) && /^couldn't read/i.test(last.name)) return true;
  return false;
}

function isPlaceholder(last: ScanShot["lastRead"]): boolean {
  if (!last) return true;
  if (isLabelRead(last) && /^reading/i.test(last.name)) return true;
  if (isReceiptRead(last) && last.items.length === 0 && !last.storeName && last.isPartial) {
    return !last.rawText;
  }
  return false;
}

export function confidenceFromRead(last: ScanShot["lastRead"]): number | null {
  if (!last || isPlaceholder(last) || isFailedRead(last)) return null;
  if (isLabelRead(last)) return extractionConfidence(last);
  if (isReceiptRead(last)) {
    const lines = last.items.length;
    const totals = last.total != null || last.subtotal != null ? 0.2 : 0;
    const score = Math.min(0.98, 0.35 + Math.min(lines, 8) * 0.07 + totals);
    return Math.round(score * 100) / 100;
  }
  return null;
}

export function tagForShot(shot: ScanShot): PhotoTag {
  const last = shot.lastRead;
  const linked = shot.kind === "receipt" ? shot.captureId != null : shot.itemId != null;
  if (isFailedRead(last)) {
    return { state: "failed", label: "Failed", confidence: null };
  }
  if (!isPlaceholder(last)) {
    const confidence = confidenceFromRead(last);
    if (linked) return { state: "in-cart", label: "In cart", confidence };
    return { state: "read", label: "Read", confidence };
  }
  if (linked) return { state: "pending", label: "Reading", confidence: null };
  return { state: "pending", label: "Pending", confidence: null };
}

export function tagTone(state: PhotoState): string {
  switch (state) {
    case "in-cart":
      return "bg-accent text-bg";
    case "read":
      return "bg-fg/85 text-bg";
    case "failed":
      return "bg-red-700 text-white";
    default:
      return "bg-bg/80 text-fg";
  }
}
