import { getSql } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

const PRICES = "https://prices.openfoodfacts.org";
const OFF = "https://world.openfoodfacts.org";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = `Tillwise/${APP_VERSION} (https://github.com/xPsIXx/tillwise)`;

export type OffConfig = {
  username: string | null;
  hasPassword: boolean;
  osmId: number | null;
  osmType: "NODE" | "WAY" | "RELATION" | null;
  osmName: string | null;
};

export type OffStoreHit = {
  osmId: number;
  osmType: "NODE" | "WAY" | "RELATION";
  name: string;
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
  };
}

export async function saveOffConfig(input: {
  username?: string;
  password?: string;
  osmId?: number | null;
  osmType?: OffConfig["osmType"];
  osmName?: string | null;
}): Promise<OffConfig> {
  if (input.username !== undefined) await put("off_username", input.username.trim() || null);
  if (input.password !== undefined) await put("off_password", input.password.trim() || null);
  if (input.osmId !== undefined) await put("off_osm_id", input.osmId != null ? String(input.osmId) : null);
  if (input.osmType !== undefined) await put("off_osm_type", input.osmType);
  if (input.osmName !== undefined) await put("off_osm_name", input.osmName);
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
  const rows = (await res.json()) as { osm_id: number; osm_type: string; display_name: string }[];
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
    }))
    .filter((r) => r.osmId);
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
  price: number;
  currency: string;
  date: string;
  osmId: number;
  osmType: OffConfig["osmType"];
  perKg?: boolean;
}): Promise<number> {
  const tok = await token();
  const body: Record<string, unknown> = {
    proof_id: opts.proofId,
    price: opts.price,
    currency: opts.currency,
    date: opts.date,
    location_osm_id: opts.osmId,
    location_osm_type: opts.osmType,
    price_per: opts.perKg ? "KILOGRAM" : "UNIT",
  };
  const code = opts.barcode?.replace(/\D/g, "") ?? "";
  if (code.length >= 8) body.product_code = code;
  if (opts.name) body.product_name = opts.name;
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
