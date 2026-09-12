import { createServerFn } from "@tanstack/react-start";
import { checkpointLedger, getSql } from "@/lib/db";
import { recordAction, readActions } from "@/lib/action-log";
import {
  asFileRef,
  isDataUrl,
  itemThumbUrl,
  receiptThumbUrl,
  shotThumbUrl,
  writeItemThumb,
  writeReceiptThumb,
  writeShotImage,
  writeShotThumb,
  removeFileRef,
} from "@/lib/photo-store";
import { storedToDataUrl } from "@/lib/media-serve";
import { canonicalGuess, nameKey as catalogKey, parseReceiptDate, perUnitPrice } from "./catalog";
import type {
  CanonicalProduct,
  CollatePreview,
  CollatedItem,
  GroceryAnalytics,
  LabelExtraction,
  LlmProvider,
  PricePoint,
  ProductMemory,
  ReceiptCapture,
  StoreUnitPrice,
  ReceiptExtraction,
  ScanShot,
  Trip,
  TripDetail,
  TripItem,
  TripStatus,
} from "./types";

/** Unowned rows — auth is off; one literal owner for the NOT NULL column. */
const OWNER = "local";

type TripRow = {
  id: number;
  store_name: string | null;
  store_location: string | null;
  started_at: unknown;
  completed_at: unknown;
  status: string;
  receipt_subtotal: unknown;
  receipt_tax: unknown;
  receipt_total: unknown;
  currency: string;
  notes: string | null;
  item_count?: unknown;
  label_count?: unknown;
  receipt_capture_count?: unknown;
};

type ItemRow = {
  id: number;
  trip_id: number;
  source: string;
  name: string;
  brand: string | null;
  description: string | null;
  barcode: string | null;
  category: string | null;
  quantity: unknown;
  quantity_unit: string | null;
  weight_value: unknown;
  weight_unit: string | null;
  unit_price: unknown;
  line_price: unknown;
  currency: string | null;
  raw_text: string | null;
  thumbnail_data: string | null;
  match_status: string;
  match_confidence: unknown;
  till_name?: string | null;
  created_at: unknown;
  product_id?: number | null;
  product_name?: string | null;
};

type ReceiptRow = {
  id: number;
  trip_id: number;
  sequence: number;
  extracted_json: string | null;
  thumbnail_data: string | null;
  created_at: unknown;
};

type ShotRow = {
  id: number;
  trip_id: number;
  kind: string;
  thumbnail_data: string | null;
  barcode: string | null;
  item_id: number | null;
  capture_id: number | null;
  last_read_json: string | null;
  created_at: unknown;
  store_name?: string | null;
};

function mapShot(row: ShotRow): ScanShot {
  let lastRead: ScanShot["lastRead"] = null;
  if (row.last_read_json) {
    try {
      lastRead = JSON.parse(row.last_read_json) as NonNullable<ScanShot["lastRead"]>;
    } catch {
      lastRead = null;
    }
  }
  return {
    id: Number(row.id),
    tripId: Number(row.trip_id),
    kind: row.kind === "receipt" ? "receipt" : "label",
    thumbnailData: row.thumbnail_data ? shotThumbUrl(Number(row.id)) : null,
    barcode: row.barcode,
    itemId: row.item_id != null ? Number(row.item_id) : null,
    captureId: row.capture_id != null ? Number(row.capture_id) : null,
    lastRead,
    createdAt: iso(row.created_at),
    storeName: row.store_name,
  };
}

async function loadShots(tripId: number): Promise<ScanShot[]> {
  const sql = await getSql();
  const rows = await sql<ShotRow>`
    select id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
      from scan_shots
     where trip_id = ${tripId}
     order by created_at desc, id desc
  `;
  return rows.map(mapShot);
}

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return new Date(String(v)).toISOString();
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  return iso(v);
}

function asStatus(v: string): TripStatus {
  if (v === "shopping" || v === "receipt" || v === "review" || v === "complete") {
    return v;
  }
  return "shopping";
}

function mapTrip(row: TripRow): Trip {
  return {
    id: Number(row.id),
    storeName: row.store_name,
    storeLocation: row.store_location,
    startedAt: iso(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    status: asStatus(row.status),
    receiptSubtotal: n(row.receipt_subtotal),
    receiptTax: n(row.receipt_tax),
    receiptTotal: n(row.receipt_total),
    currency: row.currency || "AED",
    notes: row.notes,
    itemCount: n(row.item_count) ?? 0,
    labelCount: n(row.label_count) ?? 0,
    receiptCaptureCount: n(row.receipt_capture_count) ?? 0,
  };
}

function mapItem(row: ItemRow): TripItem {
  return {
    id: Number(row.id),
    tripId: Number(row.trip_id),
    source: (row.source as TripItem["source"]) || "label",
    name: row.name,
    brand: row.brand,
    description: row.description,
    barcode: row.barcode,
    category: row.category,
    quantity: n(row.quantity),
    quantityUnit: row.quantity_unit,
    weightValue: n(row.weight_value),
    weightUnit: row.weight_unit,
    unitPrice: n(row.unit_price),
    linePrice: n(row.line_price),
    currency: row.currency,
    rawText: row.raw_text,
    thumbnailData: row.thumbnail_data ? itemThumbUrl(Number(row.id)) : null,
    matchStatus: (row.match_status as TripItem["matchStatus"]) || "unmatched",
    matchConfidence: n(row.match_confidence),
    createdAt: iso(row.created_at),
    productId: row.product_id != null ? Number(row.product_id) : null,
    productName: row.product_name ?? null,
    tillName: row.till_name ?? null,
  };
}

function mapReceipt(row: ReceiptRow): ReceiptCapture {
  let extracted: ReceiptExtraction | null = null;
  if (row.extracted_json) {
    try {
      extracted = JSON.parse(row.extracted_json) as ReceiptExtraction;
    } catch {
      extracted = null;
    }
  }
  return {
    id: Number(row.id),
    tripId: Number(row.trip_id),
    sequence: Number(row.sequence),
    extracted,
    thumbnailData: row.thumbnail_data ? receiptThumbUrl(Number(row.id)) : null,
    createdAt: iso(row.created_at),
  };
}

async function loadTrip(tripId: number): Promise<Trip | null> {
  const sql = await getSql();
  const rows = await sql.query<TripRow>(
    `select t.id, t.store_name, t.store_location, t.started_at, t.completed_at, t.status,
            t.receipt_subtotal, t.receipt_tax, t.receipt_total, t.currency, t.notes,
            (select count(*) from trip_items i where i.trip_id = t.id) as item_count,
            (select count(*) from trip_items i where i.trip_id = t.id and i.source = 'label') as label_count,
            (select count(*) from receipt_captures r where r.trip_id = t.id) as receipt_capture_count
       from trips t
      where t.id = $1
      limit 1`,
    [tripId],
  );
  return rows[0] ? mapTrip(rows[0]) : null;
}

async function loadItems(tripId: number): Promise<TripItem[]> {
  const sql = await getSql();
  const rows = await sql<ItemRow>`
    select i.id, i.trip_id, i.source, i.name, i.brand, i.description, i.barcode, i.category,
           i.quantity, i.quantity_unit, i.weight_value, i.weight_unit, i.unit_price, i.line_price,
           i.currency, i.raw_text, i.thumbnail_data, i.match_status, i.match_confidence, i.till_name, i.created_at,
           i.product_id, p.name as product_name
      from trip_items i
      left join products p on p.id = i.product_id
     where i.trip_id = ${tripId}
     order by i.created_at asc, i.id asc
  `;
  return rows.map(mapItem);
}

async function loadReceipts(tripId: number): Promise<ReceiptCapture[]> {
  const sql = await getSql();
  const rows = await sql<ReceiptRow>`
    select id, trip_id, sequence, extracted_json, thumbnail_data, created_at
      from receipt_captures
     where trip_id = ${tripId}
     order by sequence asc, id asc
  `;
  return rows.map(mapReceipt);
}

export const listTrips = createServerFn({ method: "GET" }).handler(async (): Promise<Trip[]> => {
  const sql = await getSql();
  const rows = await sql.query<TripRow>(
    `select t.id, t.store_name, t.store_location, t.started_at, t.completed_at, t.status,
            t.receipt_subtotal, t.receipt_tax, t.receipt_total, t.currency, t.notes,
            (select count(*) from trip_items i where i.trip_id = t.id) as item_count,
            (select count(*) from trip_items i where i.trip_id = t.id and i.source = 'label') as label_count,
            (select count(*) from receipt_captures r where r.trip_id = t.id) as receipt_capture_count
       from trips t
      order by t.started_at desc`,
  );
  return rows.map(mapTrip);
});

export const getTrip = createServerFn({ method: "POST" })
  .validator((tripId: number) => tripId)
  .handler(async ({ data: tripId }): Promise<TripDetail> => {
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    const [items, receipts, shots] = await Promise.all([
      loadItems(tripId),
      loadReceipts(tripId),
      loadShots(tripId),
    ]);
    return { trip, items, receipts, shots };
  });

export const createTrip = createServerFn({ method: "POST" })
  .validator((input: { storeName?: string; storeLocation?: string }) => input)
  .handler(async ({ data }): Promise<Trip> => {
    const sql = await getSql();
    const storeName = data.storeName?.trim() || null;
    const storeLocation = data.storeLocation?.trim() || null;
    const rows = await sql<TripRow>`
      insert into trips (user_id, store_name, store_location)
      values (${OWNER}, ${storeName}, ${storeLocation})
      returning id, store_name, store_location, started_at, completed_at, status,
                receipt_subtotal, receipt_tax, receipt_total, currency, notes
    `;
    const row = rows[0];
    if (!row) throw new Error("Could not start trip");
    const trip = mapTrip({ ...row, item_count: 0, label_count: 0, receipt_capture_count: 0 });
    recordAction({ action: "createTrip", ok: true, tripId: trip.id, detail: storeName ?? "unnamed" });
    await checkpointLedger();
    return trip;
  });

export const updateTrip = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      storeName?: string | null;
      storeLocation?: string | null;
      status?: TripStatus;
      notes?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<Trip> => {
    const existing = await loadTrip(data.tripId);
    if (!existing) throw new Error("Trip not found");
    const sql = await getSql();
    const storeName =
      data.storeName === undefined ? existing.storeName : data.storeName;
    const storeLocation =
      data.storeLocation === undefined ? existing.storeLocation : data.storeLocation;
    const status = data.status ?? existing.status;
    const notes = data.notes === undefined ? existing.notes : data.notes;
    await sql`
      update trips
         set store_name = ${storeName},
             store_location = ${storeLocation},
             status = ${status},
             notes = ${notes}
       where id = ${data.tripId}
    `;
    const trip = await loadTrip(data.tripId);
    if (!trip) throw new Error("Trip not found");
    return trip;
  });

export const deleteTrip = createServerFn({ method: "POST" })
  .validator((tripId: number) => tripId)
  .handler(async ({ data: tripId }): Promise<{ ok: true }> => {
    const sql = await getSql();
    const blobs = await sql<{ ref: string | null }>`
      select image_data as ref from scan_shots where trip_id = ${tripId}
      union all
      select thumbnail_data from scan_shots where trip_id = ${tripId}
      union all
      select thumbnail_data from trip_items where trip_id = ${tripId}
      union all
      select thumbnail_data from receipt_captures where trip_id = ${tripId}
    `;
    for (const row of blobs) removeFileRef(row.ref);
    await sql`delete from trips where id = ${tripId}`;
    recordAction({ action: "deleteTrip", ok: true, tripId });
    await checkpointLedger();
    return { ok: true };
  });

function extractionToInsert(extracted: LabelExtraction) {
  return {
    name: extracted.name.slice(0, 200),
    brand: extracted.brand,
    description: extracted.description,
    barcode: extracted.barcode,
    category: extracted.category,
    quantity: extracted.quantity,
    quantityUnit: extracted.quantityUnit,
    weightValue: extracted.weightValue,
    weightUnit: extracted.weightUnit,
    unitPrice: extracted.unitPrice,
    linePrice: extracted.linePrice,
    currency: extracted.currency,
    rawText: extracted.rawText,
  };
}

export const addLabelItem = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      extracted: LabelExtraction;
      thumbnailData?: string | null;
      matchStatus?: TripItem["matchStatus"];
    }) => input,
  )
  .handler(async ({ data }): Promise<TripItem> => {
    const trip = await loadTrip(data.tripId);
    if (!trip) throw new Error("Trip not found");
    const sql = await getSql();
    const e = extractionToInsert(data.extracted);
    const thumbIn = data.thumbnailData ?? null;
    const rows = await sql<ItemRow>`
      insert into trip_items (
        user_id, trip_id, source, name, brand, description, barcode, category,
        quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
        currency, raw_text, thumbnail_data, match_status
      ) values (
        ${OWNER}, ${data.tripId}, 'label', ${e.name}, ${e.brand},
        ${e.description}, ${e.barcode}, ${e.category}, ${e.quantity}, ${e.quantityUnit},
        ${e.weightValue}, ${e.weightUnit}, ${e.unitPrice}, ${e.linePrice},
        ${e.currency}, ${e.rawText}, ${null}, ${data.matchStatus ?? "unmatched"}
      )
      returning id, trip_id, source, name, brand, description, barcode, category,
                quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
                currency, raw_text, thumbnail_data, match_status, match_confidence, created_at
    `;
    const row = rows[0];
    if (!row) throw new Error("Could not save item");
    if (thumbIn && isDataUrl(thumbIn)) {
      const ref = writeItemThumb(Number(row.id), thumbIn);
      await sql`update trip_items set thumbnail_data = ${ref} where id = ${row.id}`;
      row.thumbnail_data = ref;
    }
    const item = mapItem(row);
    recordAction({ action: "addLabelItem", ok: true, tripId: data.tripId, detail: e.name });
    await rememberProduct(sql, item, trip.storeName);
    const productId = await resolveCanonical(sql, {
      name: item.name,
      brand: item.brand,
      barcode: item.barcode,
      category: item.category,
      unit: item.weightUnit ?? item.quantityUnit,
    });
    if (productId) {
      await sql`update trip_items set product_id = ${productId} where id = ${item.id}`;
      item.productId = productId;
    }
    return item;
  });

export const updateItem = createServerFn({ method: "POST" })
  .validator(
    (input: {
      itemId: number;
      patch: Partial<
        Pick<
          TripItem,
          | "name"
          | "brand"
          | "description"
          | "barcode"
          | "category"
          | "quantity"
          | "quantityUnit"
          | "weightValue"
          | "weightUnit"
          | "unitPrice"
          | "linePrice"
          | "matchStatus"
          | "matchConfidence"
          | "rawText"
        >
      >;
    }) => input,
  )
  .handler(async ({ data }): Promise<TripItem> => {
    const sql = await getSql();
    const existing = await sql<ItemRow>`
      select id, trip_id, source, name, brand, description, barcode, category,
             quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
             currency, raw_text, thumbnail_data, match_status, match_confidence, created_at
        from trip_items
       where id = ${data.itemId}
       limit 1
    `;
    const row = existing[0];
    if (!row) throw new Error("Item not found");
    const p = data.patch;
    const next = {
      name: p.name ?? row.name,
      brand: p.brand === undefined ? row.brand : p.brand,
      description: p.description === undefined ? row.description : p.description,
      barcode: p.barcode === undefined ? row.barcode : p.barcode,
      category: p.category === undefined ? row.category : p.category,
      quantity: p.quantity === undefined ? n(row.quantity) : p.quantity,
      quantityUnit: p.quantityUnit === undefined ? row.quantity_unit : p.quantityUnit,
      weightValue: p.weightValue === undefined ? n(row.weight_value) : p.weightValue,
      weightUnit: p.weightUnit === undefined ? row.weight_unit : p.weightUnit,
      unitPrice: p.unitPrice === undefined ? n(row.unit_price) : p.unitPrice,
      linePrice: p.linePrice === undefined ? n(row.line_price) : p.linePrice,
      matchStatus: p.matchStatus ?? row.match_status,
      matchConfidence:
        p.matchConfidence === undefined ? n(row.match_confidence) : p.matchConfidence,
      rawText: p.rawText === undefined ? row.raw_text : p.rawText,
    };
    const updated = await sql<ItemRow>`
      update trip_items
         set name = ${next.name},
             brand = ${next.brand},
             description = ${next.description},
             barcode = ${next.barcode},
             category = ${next.category},
             quantity = ${next.quantity},
             quantity_unit = ${next.quantityUnit},
             weight_value = ${next.weightValue},
             weight_unit = ${next.weightUnit},
             unit_price = ${next.unitPrice},
             line_price = ${next.linePrice},
             match_status = ${next.matchStatus},
             match_confidence = ${next.matchConfidence},
             raw_text = ${next.rawText}
       where id = ${data.itemId}
       returning id, trip_id, source, name, brand, description, barcode, category,
                 quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
                 currency, raw_text, thumbnail_data, match_status, match_confidence, created_at
    `;
    if (!updated[0]) throw new Error("Item not found");
    const item = mapItem(updated[0]);
    const trip = await loadTrip(item.tripId);
    await rememberProduct(sql, item, trip?.storeName ?? null);
    return item;
  });

export const deleteItem = createServerFn({ method: "POST" })
  .validator((itemId: number) => itemId)
  .handler(async ({ data: itemId }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`delete from trip_items where id = ${itemId}`;
    return { ok: true };
  });

export const scanLabelPhoto = createServerFn({ method: "POST" })
  .validator(
    (input: {
      imageDataUrl: string;
      barcodeHint?: string | null;
      detail?: "low" | "high";
      provider?: LlmProvider;
    }) => {
      if (!input.imageDataUrl || input.imageDataUrl.length > 2_400_000) {
        throw new Error("Photo is too large");
      }
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { readLabelImage } = await import("./vision");
    return readLabelImage(data.imageDataUrl, {
      barcodeHint: data.barcodeHint,
      detail: data.detail,
      provider: data.provider ?? "local",
    });
  });

export const scanReceiptPhoto = createServerFn({ method: "POST" })
  .validator(
    (input: { imageDataUrl: string; detail?: "low" | "high"; provider?: LlmProvider }) => {
      if (!input.imageDataUrl || input.imageDataUrl.length > 2_400_000) {
        throw new Error("Photo is too large");
      }
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { readReceiptImage } = await import("./vision");
    return readReceiptImage(data.imageDataUrl, {
      detail: data.detail,
      provider: data.provider ?? "local",
    });
  });

export const scanLabelPhotos = createServerFn({ method: "POST" })
  .validator(
    (input: {
      photos: { imageDataUrl: string; barcodeHint?: string | null }[];
      detail?: "low" | "high";
      provider?: LlmProvider;
    }) => {
      if (!Array.isArray(input.photos) || input.photos.length === 0) {
        throw new Error("No photos to read");
      }
      if (input.photos.length > 10) throw new Error("Too many photos in one batch");
      let total = 0;
      for (const photo of input.photos) {
        if (!photo.imageDataUrl) throw new Error("Photo is missing");
        if (photo.imageDataUrl.length > 2_400_000) throw new Error("Photo is too large");
        total += photo.imageDataUrl.length;
      }
      if (total > 8_000_000) throw new Error("Batch is too large — split the photos");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { readLabelImages } = await import("./vision");
    return readLabelImages(data.photos, {
      detail: data.detail,
      provider: data.provider ?? "local",
    });
  });

export const scanReceiptPhotos = createServerFn({ method: "POST" })
  .validator(
    (input: { images: string[]; detail?: "low" | "high"; provider?: LlmProvider }) => {
      if (!Array.isArray(input.images) || input.images.length === 0) {
        throw new Error("No photos to read");
      }
      if (input.images.length > 8) throw new Error("Too many photos in one batch");
      let total = 0;
      for (const image of input.images) {
        if (!image) throw new Error("Photo is missing");
        if (image.length > 2_400_000) throw new Error("Photo is too large");
        total += image.length;
      }
      if (total > 8_000_000) throw new Error("Batch is too large — split the photos");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { readReceiptImages } = await import("./vision");
    return readReceiptImages(data.images, {
      detail: data.detail,
      provider: data.provider ?? "local",
    });
  });

export const addReceiptCapture = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      extracted: ReceiptExtraction;
      thumbnailData?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<ReceiptCapture> => {
    const trip = await loadTrip(data.tripId);
    if (!trip) throw new Error("Trip not found");
    const sql = await getSql();
    const seqRows = await sql<{ max: unknown }>`
      select coalesce(max(sequence), -1) as max
        from receipt_captures
       where trip_id = ${data.tripId}
    `;
    const sequence = (n(seqRows[0]?.max) ?? -1) + 1;
    const json = JSON.stringify(data.extracted);
    const thumbIn = data.thumbnailData ?? null;
    const rows = await sql<ReceiptRow>`
      insert into receipt_captures (user_id, trip_id, sequence, extracted_json, thumbnail_data)
      values (${OWNER}, ${data.tripId}, ${sequence}, ${json}, ${null})
      returning id, trip_id, sequence, extracted_json, thumbnail_data, created_at
    `;
    if (trip.status === "shopping") {
      await sql`
        update trips set status = 'receipt'
         where id = ${data.tripId}
      `;
    }
    if (!rows[0]) throw new Error("Could not save receipt");
    if (thumbIn && isDataUrl(thumbIn)) {
      const ref = writeReceiptThumb(Number(rows[0].id), thumbIn);
      await sql`update receipt_captures set thumbnail_data = ${ref} where id = ${rows[0].id}`;
      rows[0].thumbnail_data = ref;
    }
    await applyReceiptMeta(sql, data.tripId, data.extracted);
    recordAction({ action: "addReceiptCapture", ok: true, tripId: data.tripId, detail: `seq ${sequence}` });
    await checkpointLedger();
    return mapReceipt(rows[0]);
  });

export const updateReceiptCapture = createServerFn({ method: "POST" })
  .validator(
    (input: {
      captureId: number;
      extracted: ReceiptExtraction;
      thumbnailData?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<ReceiptCapture> => {
    const sql = await getSql();
    const json = JSON.stringify(data.extracted);
    const rows = await sql<ReceiptRow>`
      update receipt_captures
         set extracted_json = ${json},
             thumbnail_data = coalesce(${data.thumbnailData ?? null}, thumbnail_data)
       where id = ${data.captureId}
       returning id, trip_id, sequence, extracted_json, thumbnail_data, created_at
    `;
    if (!rows[0]) throw new Error("Receipt portion not found");
    const mapped = mapReceipt(rows[0]);
    if (mapped.extracted) await applyReceiptMeta(sql, mapped.tripId, mapped.extracted);
    return mapped;
  });

export const deleteReceiptCapture = createServerFn({ method: "POST" })
  .validator((captureId: number) => captureId)
  .handler(async ({ data: captureId }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`
      delete from receipt_captures
       where id = ${captureId}
    `;
    return { ok: true };
  });

export const previewCollate = createServerFn({ method: "POST" })
  .validator((input: { tripId: number; provider?: LlmProvider }) => input)
  .handler(async ({ data }): Promise<CollatePreview> => {
    const tripId = data.tripId;
    const provider = data.provider ?? "local";
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    const [items, receipts] = await Promise.all([loadItems(tripId), loadReceipts(tripId)]);
    if (items.some((i) => i.matchStatus === "processing")) {
      throw new Error("Still reading a photo — wait, then collate.");
    }
    const labels = items.filter(
      (i) => i.source !== "receipt" && i.matchStatus !== "processing" && i.matchStatus !== "receipt_only",
    );
    const portions = receipts
      .map((r) => r.extracted)
      .filter((x): x is ReceiptExtraction => !!x);
    const { stitchReceipts, proposeCollation } = await import("./vision");
    let receipt: ReceiptExtraction | null = null;
    if (portions.length > 0) {
      const stitched = await stitchReceipts(portions, provider);
      receipt = stitched.ok ? stitched.data : portions[0];
    }
    return proposeCollation(tripId, labels, receipt, provider);
  });

export const applyCollate = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      provider?: LlmProvider;
      pairs: { labelItemId: number | null; receiptIndex: number | null }[];
    }) => input,
  )
  .handler(async ({ data }): Promise<TripDetail & { usedLocalCollate: boolean }> => {
    const tripId = data.tripId;
    const provider = data.provider ?? "local";
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    const [items, receipts] = await Promise.all([loadItems(tripId), loadReceipts(tripId)]);
    if (items.some((i) => i.matchStatus === "processing")) {
      throw new Error("Still reading a photo — wait, then collate.");
    }
    const labels = items.filter(
      (i) => i.source !== "receipt" && i.matchStatus !== "processing" && i.matchStatus !== "receipt_only",
    );
    const portions = receipts
      .map((r) => r.extracted)
      .filter((x): x is ReceiptExtraction => !!x);
    const { stitchReceipts, previewFromRows } = await import("./vision");
    let receipt: ReceiptExtraction | null = null;
    if (portions.length > 0) {
      const stitched = await stitchReceipts(portions, provider);
      receipt = stitched.ok ? stitched.data : portions[0];
    }
    const preview = previewFromRows(tripId, labels, receipt, data.pairs);
    const sql = await getSql();
    const keep = new Set<number>(
      items.filter((i) => i.matchStatus === "processing").map((i) => i.id),
    );

    for (const row of preview.rows) {
      const it = row.item;
      if (row.labelItemId != null) {
        keep.add(row.labelItemId);
        await sql`
          update trip_items
             set source = 'merged',
                 name = ${it.name},
                 brand = ${it.brand},
                 description = ${it.description},
                 barcode = ${it.barcode},
                 category = ${it.category},
                 quantity = ${it.quantity},
                 quantity_unit = ${it.quantityUnit},
                 weight_value = ${it.weightValue},
                 weight_unit = ${it.weightUnit},
                 unit_price = ${it.unitPrice},
                 line_price = ${it.linePrice},
                 currency = ${it.currency},
                 match_status = ${it.matchStatus},
                 match_confidence = ${it.matchConfidence},
                 till_name = ${it.tillName ?? row.tillName}
           where id = ${row.labelItemId}
        `;
        await rememberCatalog(sql, {
          name: it.name,
          brand: it.brand,
          barcode: it.barcode,
          category: it.category,
          quantityUnit: it.quantityUnit,
          weightUnit: it.weightUnit,
          unitPrice: it.unitPrice,
          linePrice: it.linePrice,
          weightValue: it.weightValue,
          currency: it.currency,
          tripId,
          storeName: preview.storeName ?? trip.storeName,
        });
      } else {
        const id = await insertMerged(sql, tripId, it);
        if (id) keep.add(id);
        await rememberCatalog(sql, {
          name: it.name,
          brand: it.brand,
          barcode: it.barcode,
          category: it.category,
          quantityUnit: it.quantityUnit,
          weightUnit: it.weightUnit,
          unitPrice: it.unitPrice,
          linePrice: it.linePrice,
          weightValue: it.weightValue,
          currency: it.currency,
          tripId,
          storeName: preview.storeName ?? trip.storeName,
        });
      }
    }

    const stale = items.filter((i) => !keep.has(i.id));
    for (const gone of stale) {
      await sql`delete from trip_items where id = ${gone.id}`;
    }

    const when = parseReceiptDate(preview.datetime);
    if (when) {
      await sql`
        update trips
           set status = 'review',
               store_name = coalesce(${preview.storeName}, store_name),
               store_location = coalesce(${preview.storeLocation}, store_location),
               started_at = ${when},
               receipt_subtotal = ${preview.subtotal},
               receipt_tax = ${preview.tax},
               receipt_total = ${preview.total},
               currency = ${preview.currency}
         where id = ${tripId}
      `;
    } else {
      await sql`
        update trips
           set status = 'review',
               store_name = coalesce(${preview.storeName}, store_name),
               store_location = coalesce(${preview.storeLocation}, store_location),
               receipt_subtotal = ${preview.subtotal},
               receipt_tax = ${preview.tax},
               receipt_total = ${preview.total},
               currency = ${preview.currency}
         where id = ${tripId}
      `;
    }

    recordAction({
      action: "collateTrip",
      ok: true,
      tripId,
      detail: `${preview.rows.length} lines, printed ${preview.total ?? "?"} gap ${preview.gap ?? 0}`,
    });
    await checkpointLedger();
    const next = await loadTrip(tripId);
    if (!next) throw new Error("Trip not found");
    return {
      trip: next,
      items: await loadItems(tripId),
      receipts: await loadReceipts(tripId),
      shots: await loadShots(tripId),
      usedLocalCollate: preview.usedLocalCollate,
    };
  });

export const unmatchItem = createServerFn({ method: "POST" })
  .validator((input: { itemId: number }) => input)
  .handler(async ({ data }): Promise<TripItem> => {
    const sql = await getSql();
    const rows = await sql<ItemRow>`
      select i.id, i.trip_id, i.source, i.name, i.brand, i.description, i.barcode, i.category,
             i.quantity, i.quantity_unit, i.weight_value, i.weight_unit, i.unit_price, i.line_price,
             i.currency, i.raw_text, i.thumbnail_data, i.match_status, i.match_confidence, i.till_name, i.created_at,
             i.product_id, p.name as product_name
        from trip_items i
        left join products p on p.id = i.product_id
       where i.id = ${data.itemId}
       limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Item not found");
    const item = mapItem(row);
    if (item.matchStatus !== "matched") return item;
    const tillName = item.tillName;
    const unitPrice = item.unitPrice;
    const linePrice = item.linePrice;
    await sql`
      update trip_items
         set match_status = 'label_only',
             match_confidence = null,
             till_name = null
       where id = ${item.id}
    `;
    if (tillName) {
      await insertMerged(sql, item.tripId, {
        name: tillName,
        brand: null,
        description: null,
        barcode: null,
        category: null,
        quantity: item.quantity,
        quantityUnit: item.quantityUnit,
        weightValue: null,
        weightUnit: null,
        unitPrice,
        linePrice,
        currency: item.currency,
        matchStatus: "receipt_only",
        matchConfidence: null,
        thumbnailData: null,
        tillName,
      });
    }
    recordAction({ action: "unmatchItem", ok: true, tripId: item.tripId, detail: item.name });
    await checkpointLedger();
    const next = await sql<ItemRow>`
      select i.id, i.trip_id, i.source, i.name, i.brand, i.description, i.barcode, i.category,
             i.quantity, i.quantity_unit, i.weight_value, i.weight_unit, i.unit_price, i.line_price,
             i.currency, i.raw_text, i.thumbnail_data, i.match_status, i.match_confidence, i.till_name, i.created_at,
             i.product_id, p.name as product_name
        from trip_items i
        left join products p on p.id = i.product_id
       where i.id = ${item.id}
       limit 1
    `;
    return next[0] ? mapItem(next[0]) : item;
  });

export const pairItems = createServerFn({ method: "POST" })
  .validator((input: { labelItemId: number; tillItemId: number }) => input)
  .handler(async ({ data }): Promise<TripItem> => {
    const sql = await getSql();
    const loadOne = async (id: number) => {
      const rows = await sql<ItemRow>`
        select i.id, i.trip_id, i.source, i.name, i.brand, i.description, i.barcode, i.category,
               i.quantity, i.quantity_unit, i.weight_value, i.weight_unit, i.unit_price, i.line_price,
               i.currency, i.raw_text, i.thumbnail_data, i.match_status, i.match_confidence, i.till_name, i.created_at,
               i.product_id, p.name as product_name
          from trip_items i
          left join products p on p.id = i.product_id
         where i.id = ${id}
         limit 1
      `;
      return rows[0] ? mapItem(rows[0]) : null;
    };
    const label = await loadOne(data.labelItemId);
    const till = await loadOne(data.tillItemId);
    if (!label || !till) throw new Error("Item not found");
    if (label.tripId !== till.tripId) throw new Error("Those lines are not on the same trip");
    if (till.matchStatus !== "receipt_only") throw new Error("Pick a till-only line");
    await sql`
      update trip_items
         set source = 'merged',
             match_status = 'matched',
             match_confidence = 1,
             till_name = ${till.tillName ?? till.name},
             unit_price = coalesce(${till.unitPrice}, unit_price),
             line_price = coalesce(${till.linePrice}, line_price),
             currency = coalesce(${till.currency}, currency)
       where id = ${label.id}
    `;
    await sql`delete from trip_items where id = ${till.id}`;
    recordAction({
      action: "pairItems",
      ok: true,
      tripId: label.tripId,
      detail: `${label.name} ↔ ${till.name}`,
    });
    await checkpointLedger();
    const next = await sql<ItemRow>`
      select i.id, i.trip_id, i.source, i.name, i.brand, i.description, i.barcode, i.category,
             i.quantity, i.quantity_unit, i.weight_value, i.weight_unit, i.unit_price, i.line_price,
             i.currency, i.raw_text, i.thumbnail_data, i.match_status, i.match_confidence, i.till_name, i.created_at,
             i.product_id, p.name as product_name
        from trip_items i
        left join products p on p.id = i.product_id
       where i.id = ${label.id}
       limit 1
    `;
    if (!next[0]) throw new Error("Item not found");
    return mapItem(next[0]);
  });

async function insertMerged(
  sql: Awaited<ReturnType<typeof getSql>>,
  tripId: number,
  item: CollatedItem,
): Promise<number> {
  const rows = await sql<{ id: number }>`
    insert into trip_items (
      user_id, trip_id, source, name, brand, description, barcode, category,
      quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
      currency, thumbnail_data, match_status, match_confidence, till_name
    ) values (
      ${OWNER}, ${tripId}, 'merged', ${item.name}, ${item.brand}, ${item.description},
      ${item.barcode}, ${item.category}, ${item.quantity}, ${item.quantityUnit},
      ${item.weightValue}, ${item.weightUnit}, ${item.unitPrice}, ${item.linePrice},
      ${item.currency}, ${asFileRef(item.thumbnailData) && !isDataUrl(item.thumbnailData) ? asFileRef(item.thumbnailData) : null}, ${item.matchStatus}, ${item.matchConfidence}, ${item.tillName ?? null}
    )
    returning id
  `;
  const id = Number(rows[0]?.id ?? 0);
  if (id && item.thumbnailData && isDataUrl(item.thumbnailData)) {
    const ref = writeItemThumb(id, item.thumbnailData);
    await sql`update trip_items set thumbnail_data = ${ref} where id = ${id}`;
  }
  const productId = await resolveCanonical(sql, {
    name: item.name,
    brand: item.brand,
    barcode: item.barcode,
    category: item.category,
    unit: item.weightUnit ?? item.quantityUnit,
  });
  if (id && productId) {
    await sql`update trip_items set product_id = ${productId} where id = ${id}`;
  }
  return id;
}

export const addScanShot = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      kind: "label" | "receipt";
      imageData: string;
      thumbnailData?: string | null;
      barcode?: string | null;
      itemId?: number | null;
      captureId?: number | null;
      lastRead?: LabelExtraction | ReceiptExtraction | null;
    }) => {
      if (!input.imageData || input.imageData.length > 2_400_000) {
        throw new Error("Photo is too large");
      }
      return input;
    },
  )
  .handler(async ({ data }): Promise<ScanShot> => {
    const trip = await loadTrip(data.tripId);
    if (!trip) throw new Error("Trip not found");
    const sql = await getSql();
    const json = data.lastRead ? JSON.stringify(data.lastRead) : null;
    const rows = await sql<ShotRow>`
      insert into scan_shots (
        user_id, trip_id, kind, image_data, thumbnail_data, barcode, item_id, capture_id, last_read_json
      ) values (
        ${OWNER}, ${data.tripId}, ${data.kind}, ${"pending"}, ${data.thumbnailData ? "pending" : null},
        ${data.barcode ?? null}, ${data.itemId ?? null}, ${data.captureId ?? null}, ${json}
      )
      returning id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
    `;
    if (!rows[0]) throw new Error("Could not save photo");
    const id = Number(rows[0].id);
    try {
      const imageRef = isDataUrl(data.imageData) ? writeShotImage(id, data.imageData) : data.imageData;
      const thumbRef =
        data.thumbnailData && isDataUrl(data.thumbnailData)
          ? writeShotThumb(id, data.thumbnailData)
          : data.thumbnailData ?? null;
      await sql`
        update scan_shots
           set image_data = ${imageRef}, thumbnail_data = ${thumbRef}
         where id = ${id}
      `;
      recordAction({ action: "addScanShot", ok: true, tripId: data.tripId, detail: `${data.kind} #${id}` });
      await checkpointLedger();
      return mapShot({ ...rows[0], thumbnail_data: thumbRef });
    } catch (err) {
      recordAction({ action: "addScanShot", ok: false, tripId: data.tripId, detail: String(err) });
      throw err;
    }
  });

export const updateScanShot = createServerFn({ method: "POST" })
  .validator(
    (input: {
      shotId: number;
      imageData?: string | null;
      thumbnailData?: string | null;
      barcode?: string | null;
      itemId?: number | null;
      captureId?: number | null;
      lastRead?: LabelExtraction | ReceiptExtraction | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<ScanShot> => {
    const sql = await getSql();
    const existing = await sql<ShotRow>`
      select id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
        from scan_shots
       where id = ${data.shotId}
       limit 1
    `;
    const row = existing[0];
    if (!row) throw new Error("Photo not found");
    const json =
      data.lastRead === undefined
        ? row.last_read_json
        : data.lastRead
          ? JSON.stringify(data.lastRead)
          : null;
    const thumb = data.thumbnailData === undefined ? row.thumbnail_data : data.thumbnailData;
    let storedImage: string | undefined;
    let storedThumb = thumb;
    if (data.imageData && isDataUrl(data.imageData)) {
      storedImage = writeShotImage(data.shotId, data.imageData);
    }
    if (thumb && isDataUrl(thumb)) {
      storedThumb = writeShotThumb(data.shotId, thumb);
    }
    const barcode = data.barcode === undefined ? row.barcode : data.barcode;
    const itemId = data.itemId === undefined ? row.item_id : data.itemId;
    const captureId = data.captureId === undefined ? row.capture_id : data.captureId;
    const rows = storedImage
      ? await sql<ShotRow>`
          update scan_shots
             set image_data = ${storedImage},
                 thumbnail_data = ${storedThumb},
                 barcode = ${barcode},
                 item_id = ${itemId},
                 capture_id = ${captureId},
                 last_read_json = ${json}
           where id = ${data.shotId}
           returning id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
        `
      : await sql<ShotRow>`
          update scan_shots
             set thumbnail_data = ${storedThumb},
                 barcode = ${barcode},
                 item_id = ${itemId},
                 capture_id = ${captureId},
                 last_read_json = ${json}
           where id = ${data.shotId}
           returning id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
        `;
    if (!rows[0]) throw new Error("Photo not found");
    return mapShot(rows[0]);
  });

export const getShotImage = createServerFn({ method: "POST" })
  .validator((shotId: number) => shotId)
  .handler(async ({ data: shotId }): Promise<{ image: string; shot: ScanShot }> => {
    const sql = await getSql();
    const rows = await sql<ShotRow & { image_data: string }>`
      select id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at, image_data
        from scan_shots
       where id = ${shotId}
       limit 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Photo not found");
    const image = (await storedToDataUrl(row.image_data)) ?? row.image_data;
    return { image, shot: mapShot(row) };
  });

export const deleteScanShot = createServerFn({ method: "POST" })
  .validator((shotId: number) => shotId)
  .handler(async ({ data: shotId }): Promise<{ ok: true }> => {
    const sql = await getSql();
    const existing = await sql<{ image_data: string; thumbnail_data: string | null }>`
      select image_data, thumbnail_data from scan_shots where id = ${shotId} limit 1
    `;
    if (existing[0]) {
      removeFileRef(existing[0].image_data);
      removeFileRef(existing[0].thumbnail_data);
    }
    await sql`delete from scan_shots where id = ${shotId}`;
    recordAction({ action: "deleteScanShot", ok: true, detail: `shot ${shotId}` });
    return { ok: true };
  });

export const listRecentShots = createServerFn({ method: "GET" }).handler(
  async (): Promise<ScanShot[]> => {
    const sql = await getSql();
    const rows = await sql<ShotRow>`
      select s.id, s.trip_id, s.kind, s.thumbnail_data, s.barcode, s.item_id, s.capture_id,
             s.last_read_json, s.created_at, t.store_name
        from scan_shots s
        join trips t on t.id = s.trip_id
       order by s.created_at desc, s.id desc
       limit 80
    `;
    return rows.map(mapShot);
  },
);

export const completeTrip = createServerFn({ method: "POST" })
  .validator((tripId: number) => tripId)
  .handler(async ({ data: tripId }): Promise<Trip> => {
    const sql = await getSql();
    await sql`
      update trips
         set status = 'complete',
             completed_at = now()
       where id = ${tripId}
    `;
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    const items = await loadItems(tripId);
    for (const item of items) {
      await rememberProduct(sql, item, trip.storeName);
    }
    recordAction({ action: "fileTrip", ok: true, tripId, detail: trip.storeName ?? "" });
    await checkpointLedger();
    return trip;
  });

export const reopenTrip = createServerFn({ method: "POST" })
  .validator((tripId: number) => tripId)
  .handler(async ({ data: tripId }): Promise<Trip> => {
    const sql = await getSql();
    await sql`
      update trips
         set status = 'shopping',
             completed_at = null
       where id = ${tripId}
    `;
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    recordAction({ action: "reopenTrip", ok: true, tripId });
    await checkpointLedger();
    return trip;
  });

function nameKey(name: string): string {
  return catalogKey(name);
}

async function applyReceiptMeta(
  sql: Awaited<ReturnType<typeof getSql>>,
  tripId: number,
  extracted: { storeName?: string | null; storeLocation?: string | null; datetime?: string | null },
) {
  const store = extracted.storeName?.trim() || null;
  const loc = extracted.storeLocation?.trim() || null;
  const when = parseReceiptDate(extracted.datetime ?? null);
  if (!store && !loc && !when) return;
  if (when) {
    await sql`
      update trips
         set store_name = coalesce(${store}, store_name),
             store_location = coalesce(${loc}, store_location),
             started_at = ${when}
       where id = ${tripId}
    `;
  } else {
    await sql`
      update trips
         set store_name = coalesce(${store}, store_name),
             store_location = coalesce(${loc}, store_location)
       where id = ${tripId}
    `;
  }
}

async function resolveCanonical(
  sql: Awaited<ReturnType<typeof getSql>>,
  input: { name: string; brand?: string | null; barcode?: string | null; category?: string | null; unit?: string | null },
): Promise<number | null> {
  const key = nameKey(input.name);
  const guess = canonicalGuess(input.name);
  if (!key) return null;
  const barcode = input.barcode?.trim() || null;
  if (barcode) {
    const byCode = await sql<{ product_id: number }>`
      select product_id from product_aliases where barcode = ${barcode} limit 1
    `;
    if (byCode[0]) return Number(byCode[0].product_id);
  }
  const byAlias = await sql<{ product_id: number }>`
    select product_id from product_aliases
     where alias_key = ${key} or alias_key = ${guess}
     limit 1
  `;
  if (byAlias[0]) {
    const pid = Number(byAlias[0].product_id);
    if (barcode) {
      await sql`
        insert into product_aliases (product_id, alias_key, barcode, source)
        values (${pid}, ${`bc:${barcode}`}, ${barcode}, 'auto')
        on conflict (alias_key) do nothing
      `;
    }
    return pid;
  }
  const created = await sql<{ id: number }>`
    insert into products (name, brand, category, unit)
    values (${input.name}, ${input.brand ?? null}, ${input.category ?? null}, ${input.unit ?? null})
    returning id
  `;
  const pid = Number(created[0]?.id ?? 0);
  if (!pid) return null;
  await sql`
    insert into product_aliases (product_id, alias_key, barcode, source)
    values (${pid}, ${key}, ${barcode}, 'auto')
    on conflict (alias_key) do nothing
  `;
  if (guess && guess !== key) {
    await sql`
      insert into product_aliases (product_id, alias_key, barcode, source)
      values (${pid}, ${guess}, ${barcode}, 'auto')
      on conflict (alias_key) do nothing
    `;
  }
  if (barcode) {
    await sql`
      insert into product_aliases (product_id, alias_key, barcode, source)
      values (${pid}, ${`bc:${barcode}`}, ${barcode}, 'auto')
      on conflict (alias_key) do nothing
    `;
  }
  return pid;
}

type CatalogInput = {
  name: string;
  brand: string | null;
  barcode: string | null;
  category: string | null;
  quantityUnit: string | null;
  weightUnit: string | null;
  unitPrice: number | null;
  linePrice: number | null;
  weightValue: number | null;
  currency: string | null;
  tripId: number | null;
  storeName: string | null;
};

async function rememberProduct(
  sql: Awaited<ReturnType<typeof getSql>>,
  item: TripItem,
  storeName: string | null,
) {
  if (item.matchStatus === "processing") return;
  await rememberCatalog(sql, {
    name: item.name,
    brand: item.brand,
    barcode: item.barcode,
    category: item.category,
    quantityUnit: item.quantityUnit,
    weightUnit: item.weightUnit,
    unitPrice: item.unitPrice,
    linePrice: item.linePrice,
    weightValue: item.weightValue,
    currency: item.currency,
    tripId: item.tripId,
    storeName,
  });
}

async function rememberCatalog(sql: Awaited<ReturnType<typeof getSql>>, input: CatalogInput) {
  const key = nameKey(input.name);
  if (!key || key === "reading label" || key.startsWith("couldn")) return;
  const barcode = input.barcode?.trim() || null;
  try {
    if (barcode) {
      const existing = await sql<{ id: number }>`
        select id from product_memory where barcode = ${barcode} limit 1
      `;
      if (existing[0]) {
        await sql`
          update product_memory
             set name_key = ${key},
                 name = ${input.name},
                 brand = coalesce(${input.brand}, brand),
                 category = coalesce(${input.category}, category),
                 quantity_unit = coalesce(${input.quantityUnit}, quantity_unit),
                 weight_unit = coalesce(${input.weightUnit}, weight_unit),
                 last_unit_price = coalesce(${input.unitPrice}, last_unit_price),
                 last_line_price = coalesce(${input.linePrice}, last_line_price),
                 last_weight_value = coalesce(${input.weightValue}, last_weight_value),
                 currency = coalesce(${input.currency}, currency),
                 seen_count = seen_count + 1,
                 updated_at = now()
           where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into product_memory (
            barcode, name_key, name, brand, category, quantity_unit, weight_unit,
            last_unit_price, last_line_price, last_weight_value, currency, seen_count
          ) values (
            ${barcode}, ${key}, ${input.name}, ${input.brand}, ${input.category},
            ${input.quantityUnit}, ${input.weightUnit}, ${input.unitPrice}, ${input.linePrice},
            ${input.weightValue}, ${input.currency ?? "AED"}, 1
          )
        `;
      }
    } else {
      const existing = await sql<{ id: number }>`
        select id from product_memory where name_key = ${key} and barcode is null limit 1
      `;
      if (existing[0]) {
        await sql`
          update product_memory
             set name = ${input.name},
                 brand = coalesce(${input.brand}, brand),
                 last_unit_price = coalesce(${input.unitPrice}, last_unit_price),
                 last_line_price = coalesce(${input.linePrice}, last_line_price),
                 last_weight_value = coalesce(${input.weightValue}, last_weight_value),
                 currency = coalesce(${input.currency}, currency),
                 seen_count = seen_count + 1,
                 updated_at = now()
           where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into product_memory (
            barcode, name_key, name, brand, category, quantity_unit, weight_unit,
            last_unit_price, last_line_price, last_weight_value, currency, seen_count
          ) values (
            null, ${key}, ${input.name}, ${input.brand}, ${input.category},
            ${input.quantityUnit}, ${input.weightUnit}, ${input.unitPrice}, ${input.linePrice},
            ${input.weightValue}, ${input.currency ?? "AED"}, 1
          )
        `;
      }
    }
    if (input.linePrice != null || input.unitPrice != null) {
      await sql`
        insert into price_observations (
          trip_id, barcode, name_key, name, store_name, unit_price, line_price,
          weight_value, weight_unit, currency
        ) values (
          ${input.tripId}, ${barcode}, ${key}, ${input.name}, ${input.storeName},
          ${input.unitPrice}, ${input.linePrice}, ${input.weightValue}, ${input.weightUnit},
          ${input.currency ?? "AED"}
        )
      `;
    }
    const productId = await resolveCanonical(sql, {
      name: input.name,
      brand: input.brand,
      barcode: input.barcode,
      category: input.category,
      unit: input.weightUnit ?? input.quantityUnit,
    });
    if (productId) {
      await sql`
        update product_memory set product_id = ${productId}
         where name_key = ${key} or (${barcode}::text is not null and barcode = ${barcode})
      `;
      await sql`
        update price_observations set product_id = ${productId}
         where name_key = ${key} and product_id is null
      `;
    }
  } catch (err) {
    console.error("[catalog]", err);
  }
}

export const lookupProduct = createServerFn({ method: "POST" })
  .validator((input: { barcode?: string | null; name?: string | null }) => input)
  .handler(async ({ data }): Promise<ProductMemory | null> => {
    const sql = await getSql();
    const barcode = data.barcode?.trim() || null;
    const key = data.name ? nameKey(data.name) : "";
    const rows = barcode
      ? await sql<{
          barcode: string | null;
          name_key: string;
          name: string;
          brand: string | null;
          category: string | null;
          last_unit_price: unknown;
          last_line_price: unknown;
          last_weight_value: unknown;
          currency: string | null;
          seen_count: unknown;
          updated_at: unknown;
        }>`
        select barcode, name_key, name, brand, category, last_unit_price, last_line_price,
               last_weight_value, currency, seen_count, updated_at
          from product_memory
         where barcode = ${barcode}
         limit 1
      `
      : key
        ? await sql<{
            barcode: string | null;
            name_key: string;
            name: string;
            brand: string | null;
            category: string | null;
            last_unit_price: unknown;
            last_line_price: unknown;
            last_weight_value: unknown;
            currency: string | null;
            seen_count: unknown;
            updated_at: unknown;
          }>`
          select barcode, name_key, name, brand, category, last_unit_price, last_line_price,
                 last_weight_value, currency, seen_count, updated_at
            from product_memory
           where name_key = ${key}
           order by updated_at desc
           limit 1
        `
        : [];
    const row = rows[0];
    if (!row) return null;
    return {
      barcode: row.barcode,
      nameKey: row.name_key,
      name: row.name,
      brand: row.brand,
      category: row.category,
      lastUnitPrice: n(row.last_unit_price),
      lastLinePrice: n(row.last_line_price),
      lastWeightValue: n(row.last_weight_value),
      currency: row.currency,
      seenCount: n(row.seen_count) ?? 1,
      updatedAt: iso(row.updated_at),
    };
  });

export const listPriceHistory = createServerFn({ method: "POST" })
  .validator((input: { barcode?: string | null; name?: string | null; limit?: number }) => input)
  .handler(async ({ data }): Promise<PricePoint[]> => {
    const sql = await getSql();
    const barcode = data.barcode?.trim() || null;
    const key = data.name ? nameKey(data.name) : "";
    const limit = Math.min(40, Math.max(5, data.limit ?? 16));
    const rows = barcode
      ? await sql<{
          id: number;
          name: string;
          barcode: string | null;
          store_name: string | null;
          unit_price: unknown;
          line_price: unknown;
          weight_value: unknown;
          weight_unit: string | null;
          currency: string;
          observed_at: unknown;
        }>`
        select id, name, barcode, store_name, unit_price, line_price, weight_value, weight_unit, currency, observed_at
          from price_observations
         where barcode = ${barcode}
         order by observed_at desc
         limit ${limit}
      `
      : key
        ? await sql<{
            id: number;
            name: string;
            barcode: string | null;
            store_name: string | null;
            unit_price: unknown;
            line_price: unknown;
            weight_value: unknown;
            weight_unit: string | null;
            currency: string;
            observed_at: unknown;
          }>`
          select id, name, barcode, store_name, unit_price, line_price, weight_value, weight_unit, currency, observed_at
            from price_observations
           where name_key = ${key}
           order by observed_at desc
           limit ${limit}
        `
        : await sql<{
            id: number;
            name: string;
            barcode: string | null;
            store_name: string | null;
            unit_price: unknown;
            line_price: unknown;
            weight_value: unknown;
            weight_unit: string | null;
            currency: string;
            observed_at: unknown;
          }>`
          select id, name, barcode, store_name, unit_price, line_price, weight_value, weight_unit, currency, observed_at
            from price_observations
           order by observed_at desc
           limit ${limit}
        `;
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      barcode: row.barcode,
      storeName: row.store_name,
      unitPrice: n(row.unit_price),
      linePrice: n(row.line_price),
      weightValue: n(row.weight_value),
      weightUnit: row.weight_unit,
      currency: row.currency || "AED",
      observedAt: iso(row.observed_at),
    }));
  });

export const listRememberedProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProductMemory[]> => {
    const sql = await getSql();
    const rows = await sql<{
      barcode: string | null;
      name_key: string;
      name: string;
      brand: string | null;
      category: string | null;
      last_unit_price: unknown;
      last_line_price: unknown;
      last_weight_value: unknown;
      currency: string | null;
      seen_count: unknown;
      updated_at: unknown;
    }>`
      select barcode, name_key, name, brand, category, last_unit_price, last_line_price,
             last_weight_value, currency, seen_count, updated_at
        from product_memory
       order by updated_at desc
       limit 80
    `;
    return rows.map((row) => ({
      barcode: row.barcode,
      nameKey: row.name_key,
      name: row.name,
      brand: row.brand,
      category: row.category,
      lastUnitPrice: n(row.last_unit_price),
      lastLinePrice: n(row.last_line_price),
      lastWeightValue: n(row.last_weight_value),
      currency: row.currency,
      seenCount: n(row.seen_count) ?? 1,
      updatedAt: iso(row.updated_at),
    }));
  },
);

export const listCanonicalProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<CanonicalProduct[]> => {
    const sql = await getSql();
    const rows = await sql<{
      id: number;
      name: string;
      brand: string | null;
      category: string | null;
      unit: string | null;
      alias_count: unknown;
      seen_count: unknown;
    }>`
      select p.id, p.name, p.brand, p.category, p.unit,
             (select count(*) from product_aliases a where a.product_id = p.id) as alias_count,
             coalesce((select sum(m.seen_count) from product_memory m where m.product_id = p.id), 1) as seen_count
        from products p
       order by p.updated_at desc, p.id desc
       limit 200
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      brand: row.brand,
      category: row.category,
      unit: row.unit,
      aliasCount: n(row.alias_count) ?? 0,
      seenCount: n(row.seen_count) ?? 1,
    }));
  },
);

export const searchCanonicalProducts = createServerFn({ method: "POST" })
  .validator((input: { query: string }) => input)
  .handler(async ({ data }): Promise<CanonicalProduct[]> => {
    const q = catalogKey(data.query);
    const sql = await getSql();
    const like = `%${q || data.query.trim().toLowerCase()}%`;
    const rows = await sql<{
      id: number;
      name: string;
      brand: string | null;
      category: string | null;
      unit: string | null;
    }>`
      select distinct p.id, p.name, p.brand, p.category, p.unit
        from products p
        left join product_aliases a on a.product_id = p.id
       where lower(p.name) like ${like}
          or a.alias_key like ${like}
          or coalesce(a.barcode, '') like ${like}
       order by p.name
       limit 30
    `;
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      brand: row.brand,
      category: row.category,
      unit: row.unit,
      aliasCount: 0,
      seenCount: 0,
    }));
  });

export const assignItemProduct = createServerFn({ method: "POST" })
  .validator(
    (input: {
      itemId: number;
      productId?: number | null;
      newName?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<TripItem> => {
    const sql = await getSql();
    const existing = await sql<ItemRow>`
      select id, trip_id, source, name, brand, description, barcode, category,
             quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
             currency, raw_text, thumbnail_data, match_status, match_confidence, created_at,
             product_id
        from trip_items
       where id = ${data.itemId}
       limit 1
    `;
    const row = existing[0];
    if (!row) throw new Error("Item not found");
    let productId = data.productId ?? null;
    if (!productId && data.newName?.trim()) {
      productId = await resolveCanonical(sql, {
        name: data.newName.trim(),
        brand: row.brand,
        barcode: row.barcode,
        category: row.category,
        unit: row.weight_unit ?? row.quantity_unit,
      });
    }
    if (productId) {
      const key = nameKey(row.name);
      await sql`
        insert into product_aliases (product_id, alias_key, barcode, source)
        values (${productId}, ${key}, ${row.barcode}, 'manual')
        on conflict (alias_key) do update set product_id = excluded.product_id, source = 'manual'
      `;
      if (row.barcode) {
        await sql`
          insert into product_aliases (product_id, alias_key, barcode, source)
          values (${productId}, ${`bc:${row.barcode}`}, ${row.barcode}, 'manual')
          on conflict (alias_key) do update set product_id = excluded.product_id
        `;
      }
    }
    await sql`update trip_items set product_id = ${productId} where id = ${data.itemId}`;
    const items = await loadItems(Number(row.trip_id));
    const next = items.find((i) => i.id === data.itemId);
    if (!next) throw new Error("Item not found");
    return next;
  });

export const getGroceryAnalytics = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroceryAnalytics> => {
    const sql = await getSql();
    const trips = await sql<{
      id: number;
      store_name: string | null;
      started_at: unknown;
      receipt_total: unknown;
      currency: string;
      status: string;
    }>`
      select id, store_name, started_at, receipt_total, currency, status
        from trips
       where status = 'complete' or receipt_total is not null
       order by started_at asc
    `;
    const currency = trips[0]?.currency ?? "AED";
    const usable = trips.filter((t) => n(t.receipt_total) != null);
    const totalSpend = usable.reduce((acc, t) => acc + (n(t.receipt_total) ?? 0), 0);
    const tripCount = usable.length;
    const avgBasket = tripCount ? totalSpend / tripCount : 0;

    const monthMap = new Map<string, { spend: number; trips: number }>();
    for (const t of usable) {
      const d = new Date(iso(t.started_at));
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = monthMap.get(key) ?? { spend: 0, trips: 0 };
      cur.spend += n(t.receipt_total) ?? 0;
      cur.trips += 1;
      monthMap.set(key, cur);
    }
    const months = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => {
        const [y, m] = month.split("-");
        const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-GB", {
          month: "short",
          year: "2-digit",
        });
        return { month, label, spend: v.spend, trips: v.trips };
      });

    const storeMap = new Map<
      string,
      { spend: number; trips: number; last: string | null }
    >();
    for (const t of usable) {
      const store = (t.store_name ?? "Unknown store").trim() || "Unknown store";
      const cur = storeMap.get(store) ?? { spend: 0, trips: 0, last: null };
      cur.spend += n(t.receipt_total) ?? 0;
      cur.trips += 1;
      const when = iso(t.started_at);
      if (!cur.last || when > cur.last) cur.last = when;
      storeMap.set(store, cur);
    }
    const stores = [...storeMap.entries()]
      .map(([store, v]) => ({
        store,
        spend: v.spend,
        trips: v.trips,
        avgBasket: v.trips ? v.spend / v.trips : 0,
        lastVisit: v.last,
      }))
      .sort((a, b) => b.spend - a.spend);

    const obs = await sql<{
      product_id: number | null;
      name: string;
      store_name: string | null;
      unit_price: unknown;
      line_price: unknown;
      weight_value: unknown;
      currency: string;
      observed_at: unknown;
    }>`
      select product_id, name, store_name, unit_price, line_price, weight_value, currency, observed_at
        from price_observations
       order by observed_at asc
    `;
    type Series = { name: string; productId: number | null; currency: string; points: { t: string; u: number }[] };
    const byProduct = new Map<string, Series>();
    for (const row of obs) {
      const unit = perUnitPrice(n(row.unit_price), n(row.line_price), n(row.weight_value), null);
      if (unit == null) continue;
      const key = row.product_id ? `p:${row.product_id}` : `n:${catalogKey(row.name)}`;
      const series = byProduct.get(key) ?? {
        name: row.name,
        productId: row.product_id != null ? Number(row.product_id) : null,
        currency: row.currency,
        points: [],
      };
      series.points.push({ t: iso(row.observed_at), u: unit });
      byProduct.set(key, series);
    }
    const movers = [...byProduct.values()]
      .filter((s) => s.points.length >= 2)
      .map((s) => {
        const from = s.points[0].u;
        const to = s.points[s.points.length - 1].u;
        return {
          productId: s.productId,
          name: s.name,
          from,
          to,
          changePct: from ? ((to - from) / from) * 100 : 0,
          currency: s.currency,
          unit: "/kg",
        };
      })
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    const risers = movers.filter((m) => m.changePct >= 3).slice(0, 8);
    const fallers = movers.filter((m) => m.changePct <= -3).slice(0, 8);

    const cheapestMap = new Map<string, StoreUnitPrice>();
    for (const row of obs) {
      const unit = perUnitPrice(n(row.unit_price), n(row.line_price), n(row.weight_value), null);
      if (unit == null) continue;
      const store = (row.store_name ?? "Unknown").trim() || "Unknown";
      const key = `${row.product_id ?? catalogKey(row.name)}|${store}`;
      const next: StoreUnitPrice = {
        productId: row.product_id != null ? Number(row.product_id) : null,
        name: row.name,
        store,
        unitPrice: unit,
        currency: row.currency,
        observedAt: iso(row.observed_at),
      };
      const prev = cheapestMap.get(key);
      if (!prev || iso(row.observed_at) > prev.observedAt) cheapestMap.set(key, next);
    }
    const cheapestUnit = [...cheapestMap.values()]
      .sort((a, b) => a.unitPrice - b.unitPrice)
      .slice(0, 12);

    return {
      currency,
      totalSpend,
      tripCount,
      avgBasket,
      months,
      stores,
      risers,
      fallers,
      cheapestUnit,
    };
  },
);

async function loadFullDebugDump() {
  const sql = await getSql();
  const trips = await sql.query<{
    id: number;
    store_name: string | null;
    store_location: string | null;
    started_at: unknown;
    completed_at: unknown;
    status: string;
    receipt_subtotal: unknown;
    receipt_tax: unknown;
    receipt_total: unknown;
    currency: string;
    notes: string | null;
  }>(
    `select id, store_name, store_location, started_at, completed_at, status,
            receipt_subtotal, receipt_tax, receipt_total, currency, notes
       from trips order by started_at desc`,
  );
  const items = await sql.query<{
    id: number;
    trip_id: number;
    source: string;
    name: string;
    brand: string | null;
    barcode: string | null;
    quantity: unknown;
    quantity_unit: string | null;
    weight_value: unknown;
    weight_unit: string | null;
    unit_price: unknown;
    line_price: unknown;
    match_status: string;
    match_confidence: unknown;
    raw_text: string | null;
  }>(
    `select id, trip_id, source, name, brand, barcode, quantity, quantity_unit,
            weight_value, weight_unit, unit_price, line_price, match_status,
            match_confidence, raw_text
       from trip_items order by trip_id, id`,
  );
  const receipts = await sql.query<{
    id: number;
    trip_id: number;
    sequence: number;
    extracted_json: string | null;
  }>(`select id, trip_id, sequence, extracted_json from receipt_captures order by trip_id, sequence`);
  const shots = await sql.query<{
    id: number;
    trip_id: number;
    kind: string;
    barcode: string | null;
    item_id: number | null;
    capture_id: number | null;
    last_read_json: string | null;
    created_at: unknown;
    image_chars: number;
    thumb_chars: number;
  }>(
    `select id, trip_id, kind, barcode, item_id, capture_id, last_read_json, created_at,
            length(image_data) as image_chars, length(coalesce(thumbnail_data, '')) as thumb_chars
       from scan_shots order by trip_id, id`,
  );
  const sizes = await sql.query<{
    shots: number;
    image_chars: string;
    thumb_chars: string;
    item_thumbs: string;
    receipt_thumbs: string;
  }>(
    `select
       (select count(*) from scan_shots) as shots,
       (select coalesce(sum(length(image_data)), 0) from scan_shots) as image_chars,
       (select coalesce(sum(length(thumbnail_data)), 0) from scan_shots) as thumb_chars,
       (select coalesce(sum(length(thumbnail_data)), 0) from trip_items) as item_thumbs,
       (select coalesce(sum(length(thumbnail_data)), 0) from receipt_captures) as receipt_thumbs`,
  );
  const parseJson = (raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw.slice(0, 200);
    }
  };
  return {
    trips,
    items,
    receipts: receipts.map((r) => ({ ...r, extracted: parseJson(r.extracted_json), extracted_json: undefined })),
    shots: shots.map((s) => ({
      id: s.id,
      tripId: s.trip_id,
      kind: s.kind,
      barcode: s.barcode,
      itemId: s.item_id,
      captureId: s.capture_id,
      createdAt: s.created_at,
      imageChars: Number(s.image_chars),
      thumbChars: Number(s.thumb_chars),
      lastRead: parseJson(s.last_read_json),
    })),
    blobBytes: sizes[0] ?? null,
  };
}

export const troubleshootTrip = createServerFn({ method: "POST" })
  .validator(
    (input: {
      tripId: number;
      scope?: "trip" | "full";
      provider?: LlmProvider;
      settings?: {
        read: string;
        collate: LlmProvider;
        autoAdd: boolean;
        debugSamples: boolean;
        visionDetail: "low" | "high";
        ppocrFeel: "loose" | "normal" | "strict";
        ppocrDetSize: "tiny" | "small" | "medium";
        ppocrRecSize: "tiny" | "small" | "medium";
      } | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const scope = data.scope === "full" ? "full" : "trip";
    const trip = await loadTrip(data.tripId);
    if (!trip) throw new Error("Trip not found");
    let ledger: unknown = null;
    try {
      const { inspectLedger: run } = await import("@/lib/ledger-repair");
      ledger = await run();
    } catch {
      ledger = null;
    }
    const actions = readActions(250);
    const { tripSnapshot, askLlmAboutTrip } = await import("./troubleshoot");
    const settings = (data.settings as import("./settings").ScanSettings | null) ?? null;
    let snapshot: unknown;
    if (scope === "full") {
      const dump = await loadFullDebugDump();
      const open = await tripSnapshot(
        {
          trip,
          items: await loadItems(data.tripId),
          receipts: await loadReceipts(data.tripId),
          shots: await loadShots(data.tripId),
        },
        settings,
        { ledger, actions },
      );
      snapshot = { scope: "full", openTrip: open, allTrips: dump, actions };
    } else {
      const [items, receipts, shots] = await Promise.all([
        loadItems(data.tripId),
        loadReceipts(data.tripId),
        loadShots(data.tripId),
      ]);
      snapshot = await tripSnapshot({ trip, items, receipts, shots }, settings, { ledger, actions });
    }
    const result = await askLlmAboutTrip(snapshot, data.provider ?? "byok", scope);
    if (!result.ok) throw new Error(result.error);
    recordAction({ action: `debug:${scope}`, ok: true, tripId: data.tripId });
    const app =
      snapshot && typeof snapshot === "object" && "app" in snapshot
        ? String((snapshot as { app?: string }).app ?? "")
        : "";
    const report = [
      `# Tillwise debug ${app} · ${scope === "full" ? "full ledger" : `trip ${trip.id}`}`,
      "",
      result.text,
      "",
      "## Snapshot JSON",
      "```json",
      JSON.stringify(snapshot, null, 2),
      "```",
    ].join("\n");
    return {
      diagnosis: result.text,
      report,
      scope,
      sent: {
        items: 0,
        receiptSlips: 0,
        photos: 0,
        lineSum: 0,
        receiptTotal: null as number | null,
      },
    };
  });

export const inspectLedger = createServerFn({ method: "GET" }).handler(async () => {
  const { inspectLedger: run } = await import("@/lib/ledger-repair");
  return run();
});

export const repairLedger = createServerFn({ method: "POST" }).handler(async () => {
  const { freezeLedger, releasePglite, unfreezeLedger } = await import("@/lib/db");
  freezeLedger();
  await releasePglite();
  const { repairLedger: run } = await import("@/lib/ledger-repair");
  const result = await run();
  recordAction({
    action: "repairLedger",
    ok: result.ok,
    detail: result.steps.slice(0, 4).join(" | "),
  });
  const restarting =
    result.ok && result.repaired && process.env.NODE_ENV === "production";
  if (restarting) {
    setTimeout(() => {
      console.info("[ledger] exiting so Docker restarts onto the repaired files");
      process.exit(0);
    }, 1500);
  } else {
    unfreezeLedger();
  }
  return { ...result, restarting };
});

export const logAppEvent = createServerFn({ method: "POST" })
  .validator((input: { action: string; ok: boolean; tripId?: number; detail?: string }) => input)
  .handler(async ({ data }) => {
    recordAction(data);
    return { ok: true as const };
  });

export const getLlmConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { loadLlmConfig } = await import("./llm");
  return loadLlmConfig();
});

export const listLlmModels = createServerFn({ method: "POST" })
  .validator(
    (input: {
      which: "local" | "byok";
      baseUrl?: string | null;
      apiKey?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { listRemoteModels } = await import("./llm");
    return listRemoteModels(data);
  });

export const saveLlmConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      localUrl?: string | null;
      visionModel?: string | null;
      textModel?: string | null;
      apiKey?: string | null;
      byokUrl?: string | null;
      byokVisionModel?: string | null;
      byokTextModel?: string | null;
      byokApiKey?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { saveLlmConfig: persist } = await import("./llm");
    return persist(data);
  });

export const generateCommonNames = createServerFn({ method: "POST" })
  .validator((input: { provider?: LlmProvider }) => input)
  .handler(async ({ data }): Promise<{ mapped: number }> => {
    const sql = await getSql();
    const names = await sql<{ name: string }>`
      select distinct name
        from trip_items
       where name is not null
         and trim(name) <> ''
         and name not ilike 'Reading%'
         and name not ilike 'Couldn''t%'
         and name not ilike 'Unknown%'
       order by name
       limit 200
    `;
    const { mapCommonNames } = await import("./vision");
    const result = await mapCommonNames(
      names.map((r) => r.name),
      data.provider ?? "local",
    );
    if (!result.ok) throw new Error(result.error);
    let mapped = 0;
    for (const row of result.mappings) {
      const printed = row.printed.trim();
      const common = row.common.trim();
      if (!printed || !common) continue;
      const commonKey = catalogKey(common);
      const printedKey = catalogKey(printed);
      if (!commonKey || !printedKey) continue;
      const existing = await sql<{ id: number }>`
        select id from products where lower(name) = lower(${common}) limit 1
      `;
      let productId = existing[0] ? Number(existing[0].id) : 0;
      if (!productId) {
        const created = await sql<{ id: number }>`
          insert into products (name) values (${common}) returning id
        `;
        productId = Number(created[0]?.id ?? 0);
      }
      if (!productId) continue;
      await sql`
        insert into product_aliases (product_id, alias_key, source)
        values (${productId}, ${commonKey}, 'llm')
        on conflict (alias_key) do update set product_id = excluded.product_id, source = 'llm'
      `;
      await sql`
        insert into product_aliases (product_id, alias_key, source)
        values (${productId}, ${printedKey}, 'llm')
        on conflict (alias_key) do update set product_id = excluded.product_id, source = 'llm'
      `;
      await sql`
        update trip_items
           set product_id = ${productId}
         where lower(name) = lower(${printed})
      `;
      mapped += 1;
    }
    return { mapped };
  });
