import { resolveEndpoint } from "./llm";
import { parseLabelText } from "./parse-local";
import type {
  CollatedItem,
  CollationResult,
  LabelExtraction,
  LlmProvider,
  MatchStatus,
  ReceiptExtraction,
  ReceiptLine,
  TripItem,
} from "./types";

type ChatContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };

async function chat(opts: {
  prompt: string;
  images?: string[];
  maxTokens: number;
  detail?: "low" | "high";
  provider?: LlmProvider;
  task?: "vision" | "text";
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const provider = opts.provider ?? "local";
  let endpoint: Awaited<ReturnType<typeof resolveEndpoint>>;
  try {
    endpoint = await resolveEndpoint(
      provider,
      opts.task ?? (opts.images?.length ? "vision" : "text"),
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Model is not configured." };
  }

  const detail = opts.detail ?? "high";
  const content: ChatContent[] = [];
  for (const url of opts.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url, detail },
    });
  }
  content.push({ type: "text", text: opts.prompt });

  const body: Record<string, unknown> = {
    model: endpoint.model,
    temperature: provider === "local" ? 0.1 : 0,
    max_tokens: opts.maxTokens,
    messages: [
      {
        role: "system",
        content:
          "You extract grocery data from photos. Reply with a single JSON object. Never invent barcodes or prices that are not visible. Use null for unknown fields.",
      },
      { role: "user", content },
    ],
  };
  if (endpoint.jsonMode) body.response_format = { type: "json_object" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

  const run = async () =>
    fetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });

  let res: Response;
  try {
    res = await run();
    if (!res.ok) res = await run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: `Could not reach the model (${msg}).` };
  }
  if (!res.ok) {
    return { ok: false, error: `Could not read the photo (${res.status}).` };
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) return { ok: false, error: "The reader returned an empty result." };
  return { ok: true, text };
}

function parseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asLabel(obj: Record<string, unknown>): LabelExtraction {
  const rawText = str(obj.raw_text) ?? str(obj.rawText) ?? "";
  const fallback = rawText ? parseLabelText(rawText, str(obj.barcode)) : null;
  return {
    name: str(obj.name) ?? fallback?.name ?? "Unknown item",
    brand: str(obj.brand),
    description: str(obj.description),
    barcode: str(obj.barcode) ?? fallback?.barcode ?? null,
    category: str(obj.category),
    quantity: num(obj.quantity) ?? fallback?.quantity,
    quantityUnit: str(obj.quantity_unit) ?? str(obj.quantityUnit) ?? fallback?.quantityUnit,
    weightValue: num(obj.weight_value) ?? num(obj.weightValue) ?? fallback?.weightValue ?? null,
    weightUnit: str(obj.weight_unit) ?? str(obj.weightUnit) ?? fallback?.weightUnit ?? null,
    unitPrice: num(obj.unit_price) ?? num(obj.unitPrice) ?? fallback?.unitPrice ?? null,
    linePrice: num(obj.line_price) ?? num(obj.linePrice) ?? fallback?.linePrice ?? null,
    currency: str(obj.currency) ?? fallback?.currency,
    origin: str(obj.origin),
    rawText,
  };
}

function asLine(obj: Record<string, unknown>): ReceiptLine {
  return {
    name: str(obj.name) ?? "Item",
    quantity: num(obj.quantity),
    quantityUnit: str(obj.quantity_unit) ?? str(obj.quantityUnit),
    weightValue: num(obj.weight_value) ?? num(obj.weightValue),
    weightUnit: str(obj.weight_unit) ?? str(obj.weightUnit),
    unitPrice: num(obj.unit_price) ?? num(obj.unitPrice),
    linePrice: num(obj.line_price) ?? num(obj.linePrice),
  };
}

function asReceipt(obj: Record<string, unknown>): ReceiptExtraction {
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const hint = str(obj.portion_hint) ?? str(obj.portionHint);
  const portionHint =
    hint === "top" || hint === "middle" || hint === "bottom" || hint === "full"
      ? hint
      : null;
  return {
    storeName: str(obj.store_name) ?? str(obj.storeName),
    storeLocation: str(obj.store_location) ?? str(obj.storeLocation),
    datetime: str(obj.datetime),
    isPartial: Boolean(obj.is_partial ?? obj.isPartial ?? false),
    portionHint,
    items: itemsRaw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map(asLine),
    subtotal: num(obj.subtotal),
    tax: num(obj.tax),
    total: num(obj.total),
    currency: str(obj.currency),
    rawText: str(obj.raw_text) ?? str(obj.rawText) ?? "",
  };
}

export async function readLabelImage(
  imageDataUrl: string,
  opts?: { detail?: "low" | "high"; barcodeHint?: string | null; provider?: LlmProvider },
): Promise<{ ok: true; data: LabelExtraction } | { ok: false; error: string }> {
  const hint = opts?.barcodeHint
    ? `A barcode was already read on-device as ${opts.barcodeHint}. Confirm it from the photo if visible.`
    : "";
  const result = await chat({
    maxTokens: 900,
    images: [imageDataUrl],
    detail: opts?.detail ?? "high",
    provider: opts?.provider ?? "local",
    task: "vision",
    prompt: `This is a photo of a grocery product: a produce scale sticker, packaged-goods label, shelf tag, or barcode.
Extract what is actually printed. Prefer the scale sticker when both a bag and a sticker are visible.
${hint}
GCC scale stickers (Lulu, Carrefour, Spinneys) are a grid:
WEIGHT / الوزن = net kg; UNIT PRICE / سعر الوحدة = per-kg rate even when "/kg" is not printed; large number bottom-right = amount payable (weight × unit). Barcode digits sit along the bottom.
Produce stickers usually show THREE numbers: net weight, unit price (per kg / per lb / per 100g), and line total.
- unit_price = the rate (AED/kg, $/lb, price per 100g converted to per kg by ×10). Not the total.
- line_price = the amount charged for this pack (TOTAL / NET / bottom-right money).
- barcode = the digits under the barcode or EAN/UPC printed on the sticker (8–14 digits, no spaces). Do not invent one.
If only one money amount is printed next to /kg or PER KG, that is unit_price. If weight and total are present, you may compute unit_price = total / weight_in_kg.
Return JSON with keys:
name, brand, description, barcode, category, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price, currency, origin, raw_text.
weight_unit one of g, kg, lb, oz, ml, l or null.
quantity_unit like ea, pack, bunch, carton, bottle or null.
Prices are numbers only. Currency like AED, USD. raw_text is the visible text concatenated.`,
  });
  if (!result.ok) return result;
  const obj = parseJson(result.text);
  if (!obj) return { ok: false, error: "Could not parse the label." };
  return { ok: true, data: asLabel(obj) };
}

export async function readReceiptImage(
  imageDataUrl: string,
  opts?: { detail?: "low" | "high"; provider?: LlmProvider },
): Promise<{ ok: true; data: ReceiptExtraction } | { ok: false; error: string }> {
  const result = await chat({
    maxTokens: 1400,
    images: [imageDataUrl],
    detail: opts?.detail ?? "high",
    provider: opts?.provider ?? "local",
    task: "vision",
    prompt: `This is a photo of a grocery receipt / till slip, possibly only a portion of a long tape.
Read every visible line even if the print is faint. If the receipt is cut off, set is_partial true and portion_hint to top, middle, or bottom.
Return JSON with keys:
store_name, store_location, datetime, is_partial, portion_hint, items, subtotal, tax, total, currency, raw_text.
Each item: name, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price.
unit_price is the per-unit or per-kg rate when printed (often next to weight); line_price is the charged amount.
Ignore ads, loyalty points, and payment-card numbers. Prices are numbers.`,
  });
  if (!result.ok) return result;
  const obj = parseJson(result.text);
  if (!obj) return { ok: false, error: "Could not parse the receipt." };
  return { ok: true, data: asReceipt(obj) };
}

export async function stitchReceipts(
  portions: ReceiptExtraction[],
  provider?: LlmProvider,
): Promise<{ ok: true; data: ReceiptExtraction } | { ok: false; error: string }> {
  if (portions.length === 0) {
    return { ok: false, error: "No receipt portions to stitch." };
  }
  if (portions.length === 1 && !portions[0].isPartial) {
    return { ok: true, data: portions[0] };
  }

  const result = await chat({
    maxTokens: 1800,
    provider: provider ?? "local",
    task: "text",
    prompt: `Merge these OCR results from overlapping portions of ONE grocery receipt.
Deduplicate lines that appear in more than one portion. Repair names cut off at the edges. Keep a single subtotal/tax/total (from the portion that has them).
Return JSON with the same shape: store_name, store_location, datetime, is_partial (false if complete), portion_hint ("full"), items, subtotal, tax, total, currency, raw_text.

PORTIONS:
${JSON.stringify(portions, null, 2)}`,
  });
  if (!result.ok) return { ok: true, data: mergePortionsLocally(portions) };
  const obj = parseJson(result.text);
  if (!obj) return { ok: true, data: mergePortionsLocally(portions) };
  return { ok: true, data: asReceipt(obj) };
}

function mergePortionsLocally(portions: ReceiptExtraction[]): ReceiptExtraction {
  const seen = new Set<string>();
  const items: ReceiptLine[] = [];
  for (const p of portions) {
    for (const line of p.items) {
      const key = `${line.name}|${line.linePrice ?? ""}|${line.weightValue ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(line);
    }
  }
  const last = [...portions].reverse().find((p) => p.total != null) ?? portions[portions.length - 1];
  return {
    storeName: portions.find((p) => p.storeName)?.storeName ?? null,
    storeLocation: portions.find((p) => p.storeLocation)?.storeLocation ?? null,
    datetime: portions.find((p) => p.datetime)?.datetime ?? null,
    isPartial: portions.some((p) => p.isPartial),
    portionHint: portions.length > 1 ? "full" : (last?.portionHint ?? null),
    items,
    subtotal: last?.subtotal ?? null,
    tax: last?.tax ?? null,
    total: last?.total ?? null,
    currency: last?.currency ?? "AED",
    rawText: portions.map((p) => p.rawText).filter(Boolean).join("\n"),
  };
}

function localCollate(
  labels: TripItem[],
  receipt: ReceiptExtraction | null,
): CollationResult {
  const usedReceipt = new Set<number>();
  const items: CollatedItem[] = [];

  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const STOP = new Set(["the", "and", "for", "with", "from"]);
  const tokens = (s: string) =>
    s
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w));

  const tokenHit = (a: string, b: string) =>
    a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

  for (const label of labels) {
    let best = -1;
    let bestScore = 0;
    const ln = norm([label.brand, label.name].filter(Boolean).join(" "));
    const receiptItems = receipt?.items ?? [];
    receiptItems.forEach((line, i) => {
      if (usedReceipt.has(i)) return;
      const rn = norm(line.name);
      if (!ln || !rn) return;
      let score = 0;
      if (ln === rn) score = 1;
      else if (ln.includes(rn) || rn.includes(ln)) score = 0.82;
      else {
        const lt = tokens(ln);
        const rt = tokens(rn);
        let hit = 0;
        lt.forEach((w) => {
          if (rt.some((x) => tokenHit(w, x))) hit += 1;
        });
        const union = new Set([...lt, ...rt]).size || 1;
        score = hit / union;
        if (
          label.weightValue != null &&
          line.weightValue != null &&
          Math.abs(label.weightValue - line.weightValue) < 0.02
        ) {
          score += 0.12;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });

    const matched = best >= 0 && bestScore >= 0.35 ? receiptItems[best] : null;
    if (matched) usedReceipt.add(best);

    items.push({
      name: label.name,
      brand: label.brand,
      description: label.description,
      barcode: label.barcode,
      category: label.category,
      quantity: label.quantity ?? matched?.quantity ?? null,
      quantityUnit: label.quantityUnit ?? matched?.quantityUnit ?? null,
      weightValue: label.weightValue ?? matched?.weightValue ?? null,
      weightUnit: label.weightUnit ?? matched?.weightUnit ?? null,
      unitPrice: matched?.unitPrice ?? label.unitPrice,
      linePrice: matched?.linePrice ?? label.linePrice,
      currency: label.currency ?? receipt?.currency ?? "AED",
      matchStatus: matched ? "matched" : "label_only",
      matchConfidence: matched ? Math.round(bestScore * 100) / 100 : null,
      thumbnailData: label.thumbnailData,
    });
  }

  (receipt?.items ?? []).forEach((line, i) => {
    if (usedReceipt.has(i)) return;
    items.push({
      name: line.name,
      brand: null,
      description: null,
      barcode: null,
      category: null,
      quantity: line.quantity,
      quantityUnit: line.quantityUnit,
      weightValue: line.weightValue,
      weightUnit: line.weightUnit,
      unitPrice: line.unitPrice,
      linePrice: line.linePrice,
      currency: receipt?.currency ?? "AED",
      matchStatus: "receipt_only",
      matchConfidence: null,
      thumbnailData: null,
    });
  });

  const sum = items.reduce((acc, it) => acc + (it.linePrice ?? 0), 0);
  return {
    storeName: receipt?.storeName ?? null,
    storeLocation: receipt?.storeLocation ?? null,
    datetime: receipt?.datetime ?? null,
    subtotal: receipt?.subtotal ?? (sum || null),
    tax: receipt?.tax ?? null,
    total: receipt?.total ?? (sum || null),
    currency: receipt?.currency ?? "AED",
    items,
    notes: null,
  };
}

export async function collateTripData(
  labels: TripItem[],
  receipt: ReceiptExtraction | null,
  provider?: LlmProvider,
): Promise<
  { ok: true; data: CollationResult; usedLocalCollate: boolean } | { ok: false; error: string }
> {
  const fallback = localCollate(labels, receipt);
  const useProvider = provider ?? "local";

  const result = await chat({
    maxTokens: 2000,
    provider: useProvider,
    task: "text",
    prompt: `Collate a grocery trip. Labels were photographed in the aisle (they have weights/quantities that the till often omits). The receipt has prices and may use abbreviated names.
Rules:
- Prefer label for name, brand, description, barcode, weight, quantity.
- Prefer receipt for unit_price and line_price.
- Match abbreviated till names to labels (e.g. "TOM VINE" → "Tomatoes on the Vine"). Group different names that are the same product.
- Keep receipt-only items that were never photographed.
- Keep label-only items that did not appear on the till.
- Group aisle names and till abbreviations onto one canonical product name (TOM VINE and Tomatoes on the Vine are the same).
- Copy store_name, store_location, and datetime from the receipt header when present.
- match_status: matched | label_only | receipt_only
- match_confidence: 0-1 or null
Return JSON: store_name, store_location, datetime, subtotal, tax, total, currency, notes, items[]
Each item: name, brand, description, barcode, category, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price, currency, match_status, match_confidence.

LABELS:
${JSON.stringify(
  labels.map((l) => ({
    name: l.name,
    brand: l.brand,
    description: l.description,
    barcode: l.barcode,
    category: l.category,
    quantity: l.quantity,
    quantityUnit: l.quantityUnit,
    weightValue: l.weightValue,
    weightUnit: l.weightUnit,
    unitPrice: l.unitPrice,
    linePrice: l.linePrice,
    currency: l.currency,
  })),
)}

RECEIPT:
${JSON.stringify(receipt)}`,
  });

  if (!result.ok) return { ok: true, data: fallback, usedLocalCollate: true };
  const obj = parseJson(result.text);
  if (!obj) return { ok: true, data: fallback, usedLocalCollate: true };

  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items: CollatedItem[] = rawItems
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((it, i) => {
      const statusRaw = str(it.match_status) ?? str(it.matchStatus) ?? "unmatched";
      const matchStatus: MatchStatus =
        statusRaw === "matched" ||
        statusRaw === "label_only" ||
        statusRaw === "receipt_only"
          ? statusRaw
          : "unmatched";
      const thumb =
        labels.find((l) => l.name.toLowerCase() === (str(it.name) ?? "").toLowerCase())
          ?.thumbnailData ??
        fallback.items[i]?.thumbnailData ??
        null;
      return {
        name: str(it.name) ?? "Item",
        brand: str(it.brand),
        description: str(it.description),
        barcode: str(it.barcode),
        category: str(it.category),
        quantity: num(it.quantity),
        quantityUnit: str(it.quantity_unit) ?? str(it.quantityUnit),
        weightValue: num(it.weight_value) ?? num(it.weightValue),
        weightUnit: str(it.weight_unit) ?? str(it.weightUnit),
        unitPrice: num(it.unit_price) ?? num(it.unitPrice),
        linePrice: num(it.line_price) ?? num(it.linePrice),
        currency: str(it.currency) ?? fallback.currency,
        matchStatus,
        matchConfidence: num(it.match_confidence) ?? num(it.matchConfidence),
        thumbnailData: thumb,
      };
    });

  if (items.length === 0) return { ok: true, data: fallback, usedLocalCollate: true };

  return {
    ok: true,
    usedLocalCollate: false,
    data: {
      storeName: str(obj.store_name) ?? str(obj.storeName) ?? fallback.storeName,
      storeLocation:
        str(obj.store_location) ?? str(obj.storeLocation) ?? fallback.storeLocation,
      datetime: str(obj.datetime) ?? fallback.datetime,
      subtotal: num(obj.subtotal) ?? fallback.subtotal,
      tax: num(obj.tax) ?? fallback.tax,
      total: num(obj.total) ?? fallback.total,
      currency: str(obj.currency) ?? fallback.currency,
      items,
      notes: str(obj.notes),
    },
  };
}
