import { getSql } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

const PRICES = "https://prices.openfoodfacts.org";
const OFF = "https://world.openfoodfacts.org";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = `Tillwise/${APP_VERSION} (https://github.com/xPsIXx/tillwise)`;

export type OffConfig = {
  username: string | null;
  hasPassword: boolean;
  osmId: number | null;
  osmType: "NODE" | "WAY" | "RELATION" | null;
  osmName: string | null;
  lat: number | null;
  lon: number | null;
};

export type OffStoreHit = {
  osmId: number;
  osmType: "NODE" | "WAY" | "RELATION";
  name: string;
  lat?: number;
  lon?: number;
  distanceM?: number;
};

function headers(extra?: Record<string, string>) {
  return { "User-Agent": UA, ...extra };
}

async function settings(): Promise<Record<string, string>> {
  const sql = await getSql();
  const rows = await sql<{ key: string; value: string }>`select key, value from app_settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function put(key: string, value: string | null) {
  const sql = await getSql();
  if (!value) {
    await sql`delete from app_settings where key = ${key}`;
    return;
  }
  await sql`
    insert into app_settings (key, value) values (${key}, ${value})
    on conflict (key) do update set value = excluded.value
  `;
}

export async function loadOffConfig(): Promise<OffConfig> {
  const s = await settings();
  const osmType = s.off_osm_type;
  return {
    username: s.off_username || null,
    hasPassword: Boolean(s.off_password),
    osmId: s.off_osm_id ? Number(s.off_osm_id) : null,
    osmType: osmType === "NODE" || osmType === "WAY" || osmType === "RELATION" ? osmType : null,
    osmName: s.off_osm_name || null,
    lat: s.off_osm_lat ? Number(s.off_osm_lat) : null,
    lon: s.off_osm_lon ? Number(s.off_osm_lon) : null,
  };
}

export async function saveOffConfig(input: {
  username?: string;
  password?: string;
  osmId?: number | null;
  osmType?: OffConfig["osmType"];
  osmName?: string | null;
  lat?: number | null;
  lon?: number | null;
}): Promise<OffConfig> {
  if (input.username !== undefined) await put("off_username", input.username.trim() || null);
  if (input.password !== undefined) await put("off_password", input.password.trim() || null);
  if (input.osmId !== undefined) await put("off_osm_id", input.osmId != null ? String(input.osmId) : null);
  if (input.osmType !== undefined) await put("off_osm_type", input.osmType);
  if (input.osmName !== undefined) await put("off_osm_name", input.osmName);
  if (input.lat !== undefined) await put("off_osm_lat", input.lat != null ? String(input.lat) : null);
  if (input.lon !== undefined) await put("off_osm_lon", input.lon != null ? String(input.lon) : null);
  return loadOffConfig();
}

export async function searchOffStores(q: string): Promise<OffStoreHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "ae");
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Store search ${res.status}`);
  const rows = (await res.json()) as {
    osm_id: number;
    osm_type: string;
    display_name: string;
    lat?: string;
    lon?: string;
  }[];
  const typeMap: Record<string, OffStoreHit["osmType"]> = {
    node: "NODE",
    way: "WAY",
    relation: "RELATION",
  };
  return rows
    .map((r) => ({
      osmId: Number(r.osm_id),
      osmType: typeMap[r.osm_type] ?? "NODE",
      name: r.display_name,
      lat: r.lat ? Number(r.lat) : undefined,
      lon: r.lon ? Number(r.lon) : undefined,
    }))
    .filter((r) => r.osmId);
}

const OSM_TYPE: Record<string, OffStoreHit["osmType"]> = {
  node: "NODE",
  way: "WAY",
  relation: "RELATION",
};

function metres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export async function nearbyOffStores(lat: number, lon: number): Promise<OffStoreHit[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
  try {
    const overpass = await nearbyOverpass(lat, lon);
    if (overpass.length > 0) return overpass;
  } catch (err) {
    console.warn("[nearby overpass]", err);
  }
  return nearbyNominatim(lat, lon);
}

async function nearbyOverpass(lat: number, lon: number): Promise<OffStoreHit[]> {
  const query = `[out:json][timeout:12];
(
  nwr["shop"~"supermarket|hypermarket|convenience|greengrocer|wholesale|grocery"](around:700,${lat},${lon});
);
out center tags 16;`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = (await res.json()) as {
    elements?: {
      id: number;
      type: string;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }[];
  };
  const hits: OffStoreHit[] = [];
  for (const el of json.elements ?? []) {
    const name = el.tags?.name || el.tags?.brand || el.tags?.["name:en"];
    if (!name) continue;
    const plat = el.lat ?? el.center?.lat;
    const plon = el.lon ?? el.center?.lon;
    if (plat == null || plon == null) continue;
    hits.push({
      osmId: el.id,
      osmType: OSM_TYPE[el.type] ?? "NODE",
      name,
      lat: plat,
      lon: plon,
      distanceM: Math.round(metres(lat, lon, plat, plon)),
    });
  }
  hits.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = `${h.osmType}:${h.osmId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
}

async function nearbyNominatim(lat: number, lon: number): Promise<OffStoreHit[]> {
  const d = 0.007;
  const url = new URL(NOMINATIM);
  url.searchParams.set("q", "supermarket");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "10");
  url.searchParams.set("countrycodes", "ae");
  url.searchParams.set("viewbox", `${lon - d},${lat + d},${lon + d},${lat - d}`);
  url.searchParams.set("bounded", "1");
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Store search ${res.status}`);
  const rows = (await res.json()) as {
    osm_id: number;
    osm_type: string;
    display_name: string;
    lat?: string;
    lon?: string;
  }[];
  return rows
    .map((r) => {
      const plat = r.lat ? Number(r.lat) : undefined;
      const plon = r.lon ? Number(r.lon) : undefined;
      return {
        osmId: Number(r.osm_id),
        osmType: OSM_TYPE[r.osm_type] ?? "NODE",
        name: r.display_name,
        lat: plat,
        lon: plon,
        distanceM: plat != null && plon != null ? Math.round(metres(lat, lon, plat, plon)) : undefined,
      };
    })
    .filter((r) => r.osmId)
    .sort((a, b) => (a.distanceM ?? 9e9) - (b.distanceM ?? 9e9));
}

async function token(): Promise<string> {
  const s = await settings();
  const username = s.off_username?.trim();
  const password = s.off_password?.trim();
  if (!username || !password) throw new Error("Add your Open Food Facts username and password in Settings.");
  const res = await fetch(`${PRICES}/api/v1/auth`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; detail?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.detail || `Open Prices login ${res.status}`);
  }
  return json.access_token;
}

function dataUrlToBlob(dataUrl: string): { buf: Buffer; mime: string } {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m?.[2]) throw new Error("Photo is not a data URL");
  return { buf: Buffer.from(m[2], "base64"), mime: m[1] || "image/jpeg" };
}

export async function uploadProof(opts: {
  imageDataUrl: string;
  type: "PRICE_TAG" | "RECEIPT";
  date: string;
  currency: string;
  osmId: number;
  osmType: OffConfig["osmType"];
  comment?: string;
  receiptCount?: number;
  receiptTotal?: number;
}): Promise<number> {
  const tok = await token();
  const { buf, mime } = dataUrlToBlob(opts.imageDataUrl);
  const form = new FormData();
  form.append("type", opts.type);
  form.append("currency", opts.currency);
  form.append("date", opts.date);
  if (opts.osmId && opts.osmType) {
    form.append("location_osm_id", String(opts.osmId));
    form.append("location_osm_type", opts.osmType);
  }
  if (opts.comment) form.append("owner_comment", opts.comment);
  if (opts.type === "RECEIPT") {
    if (opts.receiptCount != null) form.append("receipt_price_count", String(opts.receiptCount));
    if (opts.receiptTotal != null) form.append("receipt_price_total", String(opts.receiptTotal));
    form.append("owner_consumption", "true");
  }
  form.append("file", new File([new Uint8Array(buf)], opts.type === "RECEIPT" ? "receipt.jpg" : "label.jpg", { type: mime }));
  const res = await fetch(`${PRICES}/api/v1/proofs/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "User-Agent": UA },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: number; detail?: string };
  if (!res.ok || json.id == null) throw new Error(json.detail || `Proof upload ${res.status}`);
  return Number(json.id);
}

export async function createPrice(opts: {
  proofId: number;
  barcode?: string | null;
  name?: string | null;
  categoryTag?: string | null;
  price: number;
  currency: string;
  date: string;
  osmId: number;
  osmType: OffConfig["osmType"];
  perKg?: boolean;
}): Promise<number> {
  const tok = await token();
  const code = opts.barcode?.replace(/\D/g, "") ?? "";
  const tag = opts.categoryTag?.trim() || (!code ? categoryTagFromName(opts.name) : null);
  const body: Record<string, unknown> = {
    proof_id: opts.proofId,
    price: opts.price,
    currency: opts.currency,
    date: opts.date,
    location_osm_id: opts.osmId,
    location_osm_type: opts.osmType,
  };
  if (code.length >= 8) {
    body.product_code = code;
    if (opts.name) body.product_name = opts.name;
  } else if (tag) {
    body.category_tag = tag;
    body.price_per = opts.perKg ? "KILOGRAM" : "UNIT";
    if (opts.name) body.product_name = opts.name;
  } else {
    throw new Error(
      `${opts.name ?? "Item"} needs a barcode, or a produce name Open Prices knows (tomatoes, bananas, …)`,
    );
  }
  const res = await fetch(`${PRICES}/api/v1/prices`, {
    method: "POST",
    headers: headers({
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: number; detail?: unknown };
  if (!res.ok || json.id == null) {
    const detail = typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail ?? res.status);
    throw new Error(detail);
  }
  return Number(json.id);
}

/** Loose produce must use an Open Food Facts category tag, not a barcode. Longest match first. */
export function categoryTagFromName(name: string | null | undefined): string | null {
  const s = (name ?? "").toLowerCase();
  if (!s.trim()) return null;
  for (const [re, tag] of PRODUCE_TAGS) {
    if (re.test(s)) return tag;
  }
  return null;
}

const PRODUCE_TAGS: [RegExp, string][] = [
  [/cherry\s*tom/i, "en:cherry-tomatoes"],
  [/baby\s*potato|chat\s*potato|new\s*potato/i, "en:new-potatoes"],
  [/gala\s*apple/i, "en:gala-apples"],
  [/granny\s*smith/i, "en:granny-smith-apples"],
  [/bell\s*pepper|capsicum|sweet\s*pepper/i, "en:bell-peppers"],
  [/\btomato/i, "en:tomatoes"],
  [/\bbanana/i, "en:bananas"],
  [/\bcarrot/i, "en:carrots"],
  [/\bonion/i, "en:onions"],
  [/\bpotato/i, "en:potatoes"],
  [/\bapple/i, "en:apples"],
  [/\bcucumber/i, "en:cucumbers"],
  [/\blettuce/i, "en:lettuces"],
  [/\bgrape/i, "en:grapes"],
  [/\borange/i, "en:oranges"],
  [/\blemon/i, "en:lemons"],
  [/\blime/i, "en:limes"],
  [/\bgarlic/i, "en:garlic"],
  [/\bginger/i, "en:ginger"],
  [/\bmango/i, "en:mangoes"],
  [/\bavocado/i, "en:avocados"],
  [/\bbroccoli/i, "en:broccoli"],
  [/\bspinach/i, "en:spinachs"],
  [/\bcabbage/i, "en:cabbages"],
  [/eggplant|aubergine/i, "en:aubergines"],
  [/zucchini|courgette/i, "en:courgettes"],
  [/watermelon/i, "en:watermelons"],
  [/\bmelon/i, "en:melons"],
  [/strawberr/i, "en:strawberries"],
  [/blueberr/i, "en:blueberries"],
  [/\bpear/i, "en:pears"],
  [/\bpeach/i, "en:peaches"],
  [/pineapple/i, "en:pineapples"],
  [/\bkiwi/i, "en:kiwis"],
  [/\bdate/i, "en:dates"],
  [/coriander|cilantro/i, "en:coriander-products"],
  [/\bparsley/i, "en:parsley"],
  [/\bmint/i, "en:mints"],
  [/\bbasil/i, "en:basil"],
  [/\bokra|bhindi/i, "en:okra"],
  [/\bbeet/i, "en:beetroot"],
  [/\bcoconut/i, "en:coconuts"],
];

export async function uploadProductPhoto(barcode: string, imageDataUrl: string): Promise<void> {
  const s = await settings();
  const username = s.off_username?.trim();
  const password = s.off_password?.trim();
  if (!username || !password) throw new Error("Open Food Facts login missing");
  const code = barcode.replace(/\D/g, "");
  if (code.length < 8) throw new Error("Need a barcode to add a product photo");
  const { buf, mime } = dataUrlToBlob(imageDataUrl);
  const form = new FormData();
  form.append("user_id", username);
  form.append("password", password);
  form.append("code", code);
  form.append("imagefield", "front");
  form.append("imgupload_front", new File([new Uint8Array(buf)], "front.jpg", { type: mime }));
  const res = await fetch(`${OFF}/cgi/product_image_upload.pl`, {
    method: "POST",
    headers: { "User-Agent": UA },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Open Food Facts photo ${res.status}`);
}

export async function testOffLogin(): Promise<{ ok: true; username: string }> {
  const s = await settings();
  if (!s.off_username) throw new Error("Username required");
  await token();
  return { ok: true, username: s.off_username };
}
