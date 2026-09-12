import { resolveEndpoint } from "./llm";
import { parseLabelText, pickProductName, nameLooksWeak } from "./parse-local";
import { loadPromptPack } from "./prompt-store";
import { withShopNote } from "./prompts";
import type {
  CollatedItem,
  CollatePair,
  CollatePreview,
  LabelExtraction,
  LlmProvider,
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
  timeoutMs?: number;
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
  const urls = opts.images ?? [];
  for (let i = 0; i < urls.length; i += 1) {
    if (urls.length > 1) content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({
      type: "image_url",
      image_url: { url: urls[i], detail },
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
      signal: AbortSignal.timeout(opts.timeoutMs ?? endpoint.timeoutMs),
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
  const barcode = str(obj.barcode);
  const fallback = rawText ? parseLabelText(rawText, barcode) : null;
  const modelName = str(obj.name);
  const parsedName = fallback?.name ?? pickProductName(rawText, barcode);
  const name =
    modelName && !nameLooksWeak(modelName) && !/^unknown/i.test(modelName)
      ? modelName
      : parsedName && !nameLooksWeak(parsedName)
        ? parsedName
        : modelName ?? parsedName ?? "Unknown item";
  return {
    name,
    brand: str(obj.brand),
    description: str(obj.description),
    barcode: barcode ?? fallback?.barcode ?? null,
    category: str(obj.category),
    quantity: num(obj.quantity) ?? fallback?.quantity ?? null,
    quantityUnit: str(obj.quantity_unit) ?? str(obj.quantityUnit) ?? fallback?.quantityUnit ?? null,
    weightValue: num(obj.weight_value) ?? num(obj.weightValue) ?? fallback?.weightValue ?? null,
    weightUnit: str(obj.weight_unit) ?? str(obj.weightUnit) ?? fallback?.weightUnit ?? null,
    unitPrice: num(obj.unit_price) ?? num(obj.unitPrice) ?? fallback?.unitPrice ?? null,
    linePrice: num(obj.line_price) ?? num(obj.linePrice) ?? fallback?.linePrice ?? null,
    currency: str(obj.currency) ?? fallback?.currency ?? null,
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
    piiBoxes: asPiiBoxes(obj.pii ?? obj.pii_boxes ?? obj.piiBoxes),
  };
}

function asPiiBoxes(raw: unknown): ReceiptExtraction["piiBoxes"] {
  if (!Array.isArray(raw)) return [];
  const boxes: ReceiptExtraction["piiBoxes"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let x = num(o.x);
    let y = num(o.y);
    let w = num(o.w) ?? num(o.width);
    let h = num(o.h) ?? num(o.height);
    if (x == null || y == null || w == null || h == null) continue;
    if (w <= 0 || h <= 0) continue;
    const max = Math.max(x, y, w, h);
    if (max > 1.5 && max <= 100) {
      x /= 100;
      y /= 100;
      w /= 100;
      h /= 100;
    } else if (max > 100) {
      continue;
    }
    if (w * h > 0.45) continue;
    boxes.push({
      kind: str(o.kind) ?? "other",
      x: clamp01(x),
      y: clamp01(y),
      w: clamp01(w),
      h: clamp01(h),
    });
  }
  return boxes;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function parseJsonList(text: string, keys: string[]): Record<string, unknown>[] {
  const obj = parseJson(text);
  if (!obj) return [];
  for (const key of keys) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      return arr.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    }
  }
  if ("name" in obj || "store_name" in obj || "storeName" in obj) return [obj];
  return [];
}

function placeByIndex<T>(
  rows: Record<string, unknown>[],
  count: number,
  map: (row: Record<string, unknown>) => T,
): (T | null)[] {
  const slots: (T | null)[] = Array.from({ length: count }, () => null);
  let cursor = 0;
  for (const row of rows) {
    const idx = num(row.index);
    let at: number;
    if (idx != null && idx >= 1 && idx <= count && slots[idx - 1] == null) {
      at = idx - 1;
    } else {
      while (cursor < count && slots[cursor] != null) cursor += 1;
      if (cursor >= count) break;
      at = cursor;
      cursor += 1;
    }
    slots[at] = map(row);
  }
  return slots;
}

const LABEL_RULES = `Extract what is actually printed. Prefer the scale sticker when both a bag and a sticker are visible.
name MUST be the product wording printed on the sticker (e.g. Capsicum Yellow, Australian Carrots, Indian Onion), including origin or variety. Do not collapse it to a generic common name.
NEVER use the store name or logo — LuLu, Carrefour, Spinneys, Waitrose — or OCR of those logos (LuCug, Lolo, Carref0ur). The English produce line sits under the Arabic line, above the WEIGHT / UNIT PRICE grid. Skip field labels: WEIGHT, UNIT PRICE, EXPIRY DATE, PROD/PACKED ON, الوزن, سعر الوحدة, تاريخ الانتهاء.
GCC scale stickers (Lulu, Carrefour, Spinneys) are a grid:
WEIGHT / الوزن = net kg; UNIT PRICE / سعر الوحدة = per-kg rate even when "/kg" is not printed; large number bottom-right = amount payable (weight × unit). Barcode digits sit along the bottom.
Produce stickers usually show THREE numbers: net weight, unit price (per kg / per lb / per 100g), and line total.
- unit_price = the rate (AED/kg, $/lb, price per 100g converted to per kg by ×10). Not the total.
- line_price = the amount charged for this pack (TOTAL / NET / bottom-right money).
- barcode = the digits under the barcode or EAN/UPC printed on the sticker (8–14 digits, no spaces). Do not invent one.
If only one money amount is printed next to /kg or PER KG, that is unit_price. If weight and total are present, you may compute unit_price = total / weight_in_kg.
Each label object keys:
name, brand, description, barcode, category, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price, currency, origin, raw_text.
weight_unit one of g, kg, lb, oz, ml, l or null.
quantity_unit like ea, pack, bunch, carton, bottle or null.
Prices are numbers only. Currency like AED, USD. raw_text is the visible text concatenated.`;

const RECEIPT_RULES = `Read every visible line even if the print is faint. If the receipt is cut off, set is_partial true and portion_hint to top, middle, or bottom.
Each receipt object keys:
store_name, store_location, datetime, is_partial, portion_hint, items, subtotal, tax, total, currency, raw_text.
Each item: name, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price.
unit_price is the per-unit or per-kg rate when printed (often next to weight); line_price is the charged amount.
Ignore ads, loyalty points, and payment-card numbers. Prices are numbers.`;

export async function readLabelImage(
  imageDataUrl: string,
  opts?: {
    detail?: "low" | "high";
    barcodeHint?: string | null;
    provider?: LlmProvider;
    storeName?: string | null;
    promptOverride?: string;
  },
): Promise<{ ok: true; data: LabelExtraction } | { ok: false; error: string }> {
  const batch = await readLabelImages(
    [{ imageDataUrl, barcodeHint: opts?.barcodeHint }],
    opts,
  );
  return batch[0] ?? { ok: false, error: "Could not parse the label." };
}

export async function readLabelImages(
  photos: { imageDataUrl: string; barcodeHint?: string | null }[],
  opts?: { detail?: "low" | "high"; provider?: LlmProvider; storeName?: string | null; promptOverride?: string },
): Promise<Array<{ ok: true; data: LabelExtraction } | { ok: false; error: string }>> {
  if (photos.length === 0) return [];
  const hints = photos
    .map((p, i) =>
      p.barcodeHint
        ? `Image ${i + 1}: a barcode was already read on-device as ${p.barcodeHint}. Confirm it from the photo if visible.`
        : null,
    )
    .filter(Boolean)
    .join("\n");
  const n = photos.length;
  const pack = await loadPromptPack();
  const rules = opts?.promptOverride?.trim()
    ? opts.promptOverride.trim()
    : withShopNote(pack.label, pack, opts?.storeName);
  const result = await chat({
    maxTokens: Math.min(4000, 700 * n + 400),
    images: photos.map((p) => p.imageDataUrl),
    detail: opts?.detail ?? "high",
    provider: opts?.provider ?? "local",
    task: "vision",
    timeoutMs: n > 1 ? 180_000 : undefined,
    prompt: `You are given ${n} grocery label photo${n === 1 ? "" : "s"} (produce scale sticker, packaged-goods label, shelf tag, or barcode), in order as Image 1${n > 1 ? ` through Image ${n}` : ""}.
${rules}
${hints}
Return JSON: { "items": [ { "index": 1, ...fields }, ... ] }
items.length MUST equal ${n}. index is 1-based and matches the image number. One object per photo, even if a photo is unreadable (then name "Couldn't read" and nulls).`,
  });
  if (!result.ok) return photos.map(() => result);
  if (n === 1) {
    const obj = parseJson(result.text);
    if (!obj) return [{ ok: false, error: "Could not parse the label." }];
    const first = Array.isArray(obj.items) && obj.items[0] && typeof obj.items[0] === "object"
      ? (obj.items[0] as Record<string, unknown>)
      : obj;
    return [{ ok: true, data: asLabel(first) }];
  }
  const rows = parseJsonList(result.text, ["items", "labels"]);
  const slots = placeByIndex(rows, n, asLabel);
  return slots.map((data) =>
    data ? { ok: true as const, data } : { ok: false as const, error: "Could not parse the label." },
  );
}

export async function readReceiptImage(
  imageDataUrl: string,
  opts?: { detail?: "low" | "high"; provider?: LlmProvider; storeName?: string | null; promptOverride?: string },
): Promise<{ ok: true; data: ReceiptExtraction } | { ok: false; error: string }> {
  const batch = await readReceiptImages([imageDataUrl], opts);
  return batch[0] ?? { ok: false, error: "Could not parse the receipt." };
}

export async function readReceiptImages(
  imageDataUrls: string[],
  opts?: { detail?: "low" | "high"; provider?: LlmProvider; storeName?: string | null; promptOverride?: string },
): Promise<Array<{ ok: true; data: ReceiptExtraction } | { ok: false; error: string }>> {
  if (imageDataUrls.length === 0) return [];
  const n = imageDataUrls.length;
  const pack = await loadPromptPack();
  const rules = opts?.promptOverride?.trim()
    ? opts.promptOverride.trim()
    : withShopNote(pack.receipt, pack, opts?.storeName);
  const result = await chat({
    maxTokens: Math.min(5000, 1100 * n + 400),
    images: imageDataUrls,
    detail: opts?.detail ?? "high",
    provider: opts?.provider ?? "local",
    task: "vision",
    timeoutMs: n > 1 ? 180_000 : undefined,
    prompt: `You are given ${n} grocery receipt / till slip photo${n === 1 ? "" : "s"}, in order as Image 1${n > 1 ? ` through Image ${n}` : ""}. Each photo may be only a portion of a long tape.
${rules}
Also return pii on each receipt: boxes of shopper personal data on THAT photo as fractions 0–1 (top-left origin): { "kind": "card"|"loyalty"|"phone"|"name"|"qr"|"other", "x", "y", "w", "h" }. Box PAN/last-4, auth, loyalty/member and its barcode, shopper phone/name, app QR. Do not box store name, item lines, or totals. Empty array if none.
Return JSON: { "receipts": [ { "index": 1, ...fields }, ... ] }
receipts.length MUST equal ${n}. index is 1-based and matches the image number. One object per photo.`,
  });
  if (!result.ok) return imageDataUrls.map(() => result);
  if (n === 1) {
    const obj = parseJson(result.text);
    if (!obj) return [{ ok: false, error: "Could not parse the receipt." }];
    const first = Array.isArray(obj.receipts) && obj.receipts[0] && typeof obj.receipts[0] === "object"
      ? (obj.receipts[0] as Record<string, unknown>)
      : obj;
    return [{ ok: true, data: asReceipt(first) }];
  }
  const rows = parseJsonList(result.text, ["receipts"]);
  const slots = placeByIndex(rows, n, asReceipt);
  return slots.map((data) =>
    data
      ? { ok: true as const, data }
      : { ok: false as const, error: "Could not parse the receipt." },
  );
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

  const pack = await loadPromptPack();
  const rules = withShopNote(pack.stitch, pack, portions.find((p) => p.storeName)?.storeName);
  const result = await chat({
    maxTokens: 1800,
    provider: provider ?? "local",
    task: "text",
    prompt: `${rules}

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
    piiBoxes: [],
  };
}

function nameScore(a: string, b: string): number {
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
  const tokenHit = (x: string, y: string) =>
    x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));
  const ln = norm(a);
  const rn = norm(b);
  if (!ln || !rn) return 0;
  if (ln === rn) return 1;
  if (ln.includes(rn) || rn.includes(ln)) return 0.82;
  const lt = tokens(ln);
  const rt = tokens(rn);
  let hit = 0;
  lt.forEach((w) => {
    if (rt.some((x) => tokenHit(w, x))) hit += 1;
  });
  const union = new Set([...lt, ...rt]).size || 1;
  return hit / union;
}

/** Matched = a shelf label AND a till line. Never “matched” from a price fill-in. */
function mergeLabelWithLine(label: TripItem, line: ReceiptLine | null, score: number | null): CollatedItem {
  const matched = Boolean(line);
  return {
    name: label.name,
    brand: label.brand,
    description: label.description,
    barcode: label.barcode,
    category: label.category,
    quantity: label.quantity ?? line?.quantity ?? null,
    quantityUnit: label.quantityUnit ?? line?.quantityUnit ?? null,
    weightValue: label.weightValue ?? line?.weightValue ?? null,
    weightUnit: label.weightUnit ?? line?.weightUnit ?? null,
    unitPrice: line?.unitPrice ?? label.unitPrice,
    linePrice: line?.linePrice ?? label.linePrice,
    currency: label.currency ?? "AED",
    matchStatus: matched ? "matched" : "label_only",
    matchConfidence: matched && score != null ? Math.round(score * 100) / 100 : null,
    thumbnailData: label.thumbnailData,
    tillName: line?.name ?? null,
  };
}

function tillOnlyItem(line: ReceiptLine, currency: string): CollatedItem {
  return {
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
    currency,
    matchStatus: "receipt_only",
    matchConfidence: null,
    thumbnailData: null,
    tillName: line.name,
  };
}

function rowsFromPairing(
  labels: TripItem[],
  receipt: ReceiptExtraction | null,
  assigned: Map<number, number>,
): CollatePair[] {
  const receiptItems = receipt?.items ?? [];
  const used = new Set(assigned.values());
  const currency = receipt?.currency ?? "AED";
  const rows: CollatePair[] = [];

  for (const label of labels) {
    const idx = assigned.get(label.id);
    const line = idx != null ? receiptItems[idx] ?? null : null;
    const score =
      line != null
        ? nameScore([label.brand, label.name].filter(Boolean).join(" "), line.name)
        : null;
    rows.push({
      labelItemId: label.id,
      receiptIndex: idx ?? null,
      aisleName: label.name,
      tillName: line?.name ?? null,
      item: mergeLabelWithLine(label, line, score),
    });
  }

  receiptItems.forEach((line, i) => {
    if (used.has(i)) return;
    rows.push({
      labelItemId: null,
      receiptIndex: i,
      aisleName: line.name,
      tillName: line.name,
      item: tillOnlyItem(line, currency),
    });
  });
  return rows;
}

function localAssign(labels: TripItem[], receipt: ReceiptExtraction | null): Map<number, number> {
  const assigned = new Map<number, number>();
  const used = new Set<number>();
  const receiptItems = receipt?.items ?? [];
  for (const label of labels) {
    let best = -1;
    let bestScore = 0;
    const ln = [label.brand, label.name].filter(Boolean).join(" ");
    receiptItems.forEach((line, i) => {
      if (used.has(i)) return;
      let score = nameScore(ln, line.name);
      if (
        label.weightValue != null &&
        line.weightValue != null &&
        Math.abs(label.weightValue - line.weightValue) < 0.02
      ) {
        score += 0.12;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= 0.55) {
      assigned.set(label.id, best);
      used.add(best);
    }
  }
  return assigned;
}

function finishPreview(
  tripId: number,
  rows: CollatePair[],
  receipt: ReceiptExtraction | null,
  usedLocalCollate: boolean,
): CollatePreview {
  const lineSum = Math.round(rows.reduce((acc, r) => acc + (r.item.linePrice ?? 0), 0) * 100) / 100;
  const total = receipt?.total ?? null;
  const gap =
    total != null ? Math.round((lineSum - total) * 100) / 100 : null;
  return {
    tripId,
    rows,
    storeName: receipt?.storeName ?? null,
    storeLocation: receipt?.storeLocation ?? null,
    datetime: receipt?.datetime ?? null,
    subtotal: receipt?.subtotal ?? null,
    tax: receipt?.tax ?? null,
    total,
    currency: receipt?.currency ?? "AED",
    lineSum,
    gap,
    usedLocalCollate,
  };
}

export async function proposeCollation(
  tripId: number,
  labels: TripItem[],
  receipt: ReceiptExtraction | null,
  provider?: LlmProvider,
): Promise<CollatePreview> {
  const local = localAssign(labels, receipt);
  const useProvider = provider ?? "local";
  const pack = await loadPromptPack();
  const rules = withShopNote(pack.collate, pack, receipt?.storeName);
  const result = await chat({
    maxTokens: 1200,
    provider: useProvider,
    task: "text",
    prompt: `${rules}

LABELS:
${JSON.stringify(labels.map((l) => ({ id: l.id, name: l.name, brand: l.brand, weight: l.weightValue, unit: l.weightUnit })))}

RECEIPT.items:
${JSON.stringify((receipt?.items ?? []).map((line, i) => ({ index: i, name: line.name, line_price: line.linePrice, weight: line.weightValue })))}`,
  });

  let assigned = local;
  let usedLocal = true;
  if (result.ok) {
    const obj = parseJson(result.text);
    const raw = obj && Array.isArray(obj.matches) ? obj.matches : [];
    const next = new Map<number, number>();
    const used = new Set<number>();
    const labelIds = new Set(labels.map((l) => l.id));
    const n = receipt?.items.length ?? 0;
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const lid = num(rec.label_id) ?? num(rec.labelId);
      const idx = num(rec.receipt_index) ?? num(rec.receiptIndex);
      if (lid == null || !labelIds.has(lid)) continue;
      if (idx == null || idx < 0 || idx >= n || used.has(idx)) continue;
      next.set(lid, idx);
      used.add(idx);
    }
    if (next.size > 0) {
      const leftover = labels.filter((l) => !next.has(l.id));
      const restReceipt: ReceiptExtraction | null = receipt
        ? { ...receipt, items: receipt.items.filter((_, i) => !used.has(i)) }
        : null;
      const rest = localAssign(leftover, restReceipt);
      const indexMap: number[] = [];
      receipt?.items.forEach((_, i) => {
        if (!used.has(i)) indexMap.push(i);
      });
      for (const [lid, localIdx] of rest) {
        const real = indexMap[localIdx];
        if (real != null) next.set(lid, real);
      }
      assigned = next;
      usedLocal = false;
    }
  }

  const rows = rowsFromPairing(labels, receipt, assigned);
  return finishPreview(tripId, rows, receipt, usedLocal);
}

export function previewFromRows(
  tripId: number,
  labels: TripItem[],
  receipt: ReceiptExtraction | null,
  pairs: { labelItemId: number | null; receiptIndex: number | null }[],
): CollatePreview {
  const assigned = new Map<number, number>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (p.labelItemId != null && p.receiptIndex != null && !used.has(p.receiptIndex)) {
      assigned.set(p.labelItemId, p.receiptIndex);
      used.add(p.receiptIndex);
    }
  }
  const rows = rowsFromPairing(labels, receipt, assigned);
  return finishPreview(tripId, rows, receipt, true);
}

export async function mapCommonNames(
  printed: string[],
  provider?: LlmProvider,
): Promise<{ ok: true; mappings: { printed: string; common: string }[] } | { ok: false; error: string }> {
  const unique = [...new Set(printed.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: true, mappings: [] };
  const pack = await loadPromptPack();
  const result = await chat({
    maxTokens: 1800,
    provider: provider ?? "byok",
    task: "text",
    prompt: `${pack.common}

NAMES:
${JSON.stringify(unique)}`,
  });
  if (!result.ok) return result;
  const obj = parseJson(result.text);
  const rows = obj && Array.isArray(obj.mappings) ? obj.mappings : [];
  const mappings: { printed: string; common: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const p = str(rec.printed) ?? str(rec.name);
    const c = str(rec.common) ?? str(rec.canonical);
    if (p && c) mappings.push({ printed: p, common: c });
  }
  return { ok: true, mappings };
}
