export const PROMPT_KEYS = ["label", "receipt", "collate", "common", "stitch"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export type PromptPack = {
  label: string;
  receipt: string;
  collate: string;
  common: string;
  stitch: string;
  shops: Record<string, string>;
  aliases: Record<string, string>;
};

export const PROMPT_META: Record<PromptKey, { title: string; hint: string }> = {
  label: {
    title: "Label / sticker",
    hint: "Vision. Produce scale stickers and shelf tags. Keep printed wording, not a generic name.",
  },
  receipt: {
    title: "Till slip",
    hint: "Vision. One photo of till tape. Line names, prices, totals.",
  },
  stitch: {
    title: "Stitch till portions",
    hint: "Text. Merge overlapping receipt OCR into one slip.",
  },
  collate: {
    title: "Collate",
    hint: "Text. Pair aisle names with till abbreviations. Does not invent lines.",
  },
  common: {
    title: "Stats names",
    hint: "Text. Map printed names to a stats key. Variety stays; country drops.",
  },
};

export const DEFAULT_PROMPTS: Omit<PromptPack, "shops" | "aliases"> = {
  label: `Extract what is actually printed. Prefer the scale sticker when both a bag and a sticker are visible.
name MUST be the product wording printed on the sticker (e.g. Capsicum Yellow, Australian Carrots, Indian Onion), including origin or variety. Do not collapse it to a generic common name.
NEVER use the store name or logo — LuLu, Carrefour, Spinneys, Waitrose — or OCR of those logos (LuCug, Lolo, Carref0ur). The English produce line sits under the Arabic line, above the WEIGHT / UNIT PRICE grid. Skip field labels: WEIGHT, UNIT PRICE, EXPIRY DATE, PROD/PACKED ON, الوزن, سعر الوحدة, تاريخ الانتهاء.
GCC scale stickers (Lulu, Carrefour, Spinneys) are a grid:
WEIGHT / الوزن = net kg; UNIT PRICE / سعر الوحدة = per-kg rate even when "/kg" is not printed; large number bottom-right = amount payable (weight × unit). Barcode digits sit along the bottom.
Produce stickers usually show THREE numbers: net weight, unit price (per kg / per lb / per 100g), and line total.
- unit_price = the rate (AED/kg, $/lb, price per 100g converted to per kg by ×10). Not the total.
- line_price = the amount charged for this pack (TOTAL / NET / bottom-right money).
- barcode = the digits under the barcode or EAN/UPC printed on the sticker (8–14 digits, no spaces). Do not invent one.
If only one money amount is printed next to /kg or PER KG, that is unit_price. If weight and total are present, you may compute unit_price = total ÷ weight_in_kg.
Each label object keys:
name, brand, description, barcode, category, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price, currency, origin, raw_text.
weight_unit: one of g, kg, lb, oz, ml, l or null.
quantity_unit like ea, pack, bunch, carton, bottle or null.
Prices are numbers only. Currency like AED, USD. raw_text is the visible text concatenated.`,
  receipt: `Read every visible line even if the print is faint. If the receipt is cut off, set is_partial true and portion_hint to top, middle, or bottom.
Each receipt object keys:
store_name, store_location, datetime, is_partial, portion_hint, items, subtotal, tax, total, currency, raw_text, pii.
Each item: name, quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price.
unit_price is the per-unit or per-kg rate when printed (often next to weight); line_price is the charged amount.
Prices are numbers.
pii is boxes of shopper personal data on THIS photo, as fractions 0–1 of the image (origin top-left). Each: { "kind": "card"|"loyalty"|"phone"|"name"|"qr"|"other", "x": 0, "y": 0, "w": 0, "h": 0 }.
Box: PAN / last-4, auth code, loyalty or member number and its barcode, shopper phone, shopper name, app QR.
Do NOT box: store name, CR number, item lines, totals, store header phone.
If none, pii is [].`,
  stitch: `Merge these OCR results from overlapping portions of ONE grocery receipt.
Deduplicate lines that appear in more than one portion. Repair names cut off at the edges. Keep a single subtotal/tax/total (from the portion that has them).
Return JSON with the same shape: store_name, store_location, datetime, is_partial (false if complete), portion_hint ("full"), items, subtotal, tax, total, currency, raw_text.`,
  collate: `Match aisle label photos to till-slip lines. One label to at most one till line. Do not invent products.

Return JSON only: { "matches": [ { "label_id": number, "receipt_index": number } ] }
receipt_index is 0-based into RECEIPT.items. Omit a label (or use receipt_index -1) if it is not on the till.
Each receipt_index at most once. Prefer matching abbreviations (TOM VINE → Tomatoes on the Vine).`,
  common: `Map printed grocery names to a statistics key. Do not rewrite the printed wording.

Drop country/origin only:
- Australian Carrots → Carrots
- South African Apples → Apples
- Indian Onion → Onion
- USA Gala Apples → Gala Apples

Keep variety and form. Do not collapse them:
- Cherry Tomatoes stay Cherry Tomatoes (not Tomatoes)
- Baby Potatoes stay Baby Potatoes (not Potatoes)
- Vine / on-the-vine tomatoes stay Vine Tomatoes
- Gala Apples stay Gala Apples (not Apples)
- Capsicum Yellow stay Capsicum Yellow (not Capsicum) if colour is on the sticker

Same variety from two countries is the same key. Pack size is not a new key.
If unsure, common = printed (strip country words only).
Do not invent names missing from the list.

Return JSON: { "mappings": [ { "printed": "...", "common": "..." } ] }`,
};

export function emptyPromptPack(): PromptPack {
  return { ...DEFAULT_PROMPTS, shops: {}, aliases: {} };
}

const FILLER =
  /\b(hypermarket|hyper|supermarket|market|mall|llc|trading|co|the|store|centre|center|city|extra|express|branch)\b/g;

export function normalizeShop(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shopsLookAlike(a: string, b: string): boolean {
  const na = normalizeShop(a);
  const nb = normalizeShop(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return long.startsWith(`${short} `);
}

export function resolveShopKey(
  store: string | null | undefined,
  pack: Pick<PromptPack, "shops" | "aliases">,
): string | null {
  const key = store?.trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(pack.shops, key)) return key;
  if (pack.aliases[key]) return pack.aliases[key];
  const n = normalizeShop(key);
  if (!n) return key;
  for (const name of Object.keys(pack.shops)) {
    if (normalizeShop(name) === n || shopsLookAlike(key, name)) return name;
  }
  for (const [alias, canon] of Object.entries(pack.aliases)) {
    if (normalizeShop(alias) === n || shopsLookAlike(key, alias)) return canon;
  }
  return key;
}

export function withShopNote(
  base: string,
  pack: Pick<PromptPack, "shops" | "aliases">,
  store: string | null | undefined,
) {
  const key = resolveShopKey(store, pack);
  if (!key) return base;
  const note = pack.shops[key]?.trim();
  if (!note) return base;
  const printed = store?.trim();
  const label = printed && printed !== key ? `${key} (as ${printed})` : key;
  return `${base}\n\nShop notes for ${label}:\n${note}`;
}

export function suggestAliases(names: string[], pack: Pick<PromptPack, "shops" | "aliases">) {
  const aliases = { ...pack.aliases };
  const canon = Object.keys(pack.shops);
  const all = [...new Set([...canon, ...names.map((n) => n.trim()).filter(Boolean)])];
  const shortest = [...all].sort((a, b) => normalizeShop(a).length - normalizeShop(b).length);
  for (const name of all) {
    if (aliases[name] || pack.shops[name]?.trim()) continue;
    const hit = shortest.find(
      (other) => other !== name && shopsLookAlike(name, other) && (pack.shops[other] != null || canon.includes(other)),
    );
    if (hit && hit !== name) aliases[name] = pack.aliases[hit] ?? hit;
  }
  return aliases;
}
