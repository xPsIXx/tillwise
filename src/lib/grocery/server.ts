import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import type {
  CollatedItem,
  LabelExtraction,
  LlmProvider,
  PricePoint,
  ProductMemory,
  ReceiptCapture,
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
  created_at: unknown;
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
    thumbnailData: row.thumbnail_data,
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
    thumbnailData: row.thumbnail_data,
    matchStatus: (row.match_status as TripItem["matchStatus"]) || "unmatched",
    matchConfidence: n(row.match_confidence),
    createdAt: iso(row.created_at),
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
    thumbnailData: row.thumbnail_data,
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
    select id, trip_id, source, name, brand, description, barcode, category,
           quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
           currency, raw_text, thumbnail_data, match_status, match_confidence, created_at
      from trip_items
     where trip_id = ${tripId}
     order by created_at asc, id asc
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
    return mapTrip({ ...row, item_count: 0, label_count: 0, receipt_capture_count: 0 });
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
    await sql`delete from trips where id = ${tripId}`;
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
    const thumb = data.thumbnailData ?? null;
    const rows = await sql<ItemRow>`
      insert into trip_items (
        user_id, trip_id, source, name, brand, description, barcode, category,
        quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
        currency, raw_text, thumbnail_data, match_status
      ) values (
        ${OWNER}, ${data.tripId}, 'label', ${e.name}, ${e.brand},
        ${e.description}, ${e.barcode}, ${e.category}, ${e.quantity}, ${e.quantityUnit},
        ${e.weightValue}, ${e.weightUnit}, ${e.unitPrice}, ${e.linePrice},
        ${e.currency}, ${e.rawText}, ${thumb}, ${data.matchStatus ?? "unmatched"}
      )
      returning id, trip_id, source, name, brand, description, barcode, category,
                quantity, quantity_unit, weight_value, weight_unit, unit_price, line_price,
                currency, raw_text, thumbnail_data, match_status, match_confidence, created_at
    `;
    const row = rows[0];
    if (!row) throw new Error("Could not save item");
    const item = mapItem(row);
    await rememberProduct(sql, item, trip.storeName);
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
    const thumb = data.thumbnailData ?? null;
    const rows = await sql<ReceiptRow>`
      insert into receipt_captures (user_id, trip_id, sequence, extracted_json, thumbnail_data)
      values (${OWNER}, ${data.tripId}, ${sequence}, ${json}, ${thumb})
      returning id, trip_id, sequence, extracted_json, thumbnail_data, created_at
    `;
    if (trip.status === "shopping") {
      await sql`
        update trips set status = 'receipt'
         where id = ${data.tripId}
      `;
    }
    if (!rows[0]) throw new Error("Could not save receipt");
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
    return mapReceipt(rows[0]);
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

export const collateTrip = createServerFn({ method: "POST" })
  .validator((input: { tripId: number; provider?: LlmProvider }) => input)
  .handler(async ({ data }): Promise<TripDetail & { usedLocalCollate: boolean }> => {
    const tripId = data.tripId;
    const provider = data.provider ?? "local";
    const trip = await loadTrip(tripId);
    if (!trip) throw new Error("Trip not found");
    const [items, receipts] = await Promise.all([loadItems(tripId), loadReceipts(tripId)]);
    const labels = items.filter(
      (i) =>
        (i.source === "label" || i.source === "merged") && i.matchStatus !== "processing",
    );
    const portions = receipts
      .map((r) => r.extracted)
      .filter((x): x is ReceiptExtraction => !!x);

    const { stitchReceipts, collateTripData } = await import("./vision");
    if (items.some((i) => i.matchStatus === "processing")) {
      throw new Error("Still reading a photo — wait, then collate.");
    }
    let receipt: ReceiptExtraction | null = null;
    if (portions.length > 0) {
      const stitched = await stitchReceipts(portions, provider);
      receipt = stitched.ok ? stitched.data : portions[0];
    }

    const collated = await collateTripData(labels, receipt, provider);
    if (!collated.ok) throw new Error(collated.error);

    const sql = await getSql();
    const previous = items;
    const linkedShots = await sql<{ id: number; item_id: number }>`
      select id, item_id from scan_shots
       where trip_id = ${tripId} and item_id is not null
    `;
    await sql`delete from trip_items where trip_id = ${tripId}`;

    const newByName = new Map<string, number>();
    const newByBarcode = new Map<string, number>();
    for (const item of collated.data.items) {
      const id = await insertMerged(sql, tripId, item);
      newByName.set(item.name.toLowerCase().trim(), id);
      if (item.barcode) newByBarcode.set(item.barcode, id);
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
        tripId,
        storeName: collated.data.storeName ?? trip.storeName,
      });
    }

    const prevById = new Map(previous.map((p) => [p.id, p]));
    for (const shot of linkedShots) {
      const old = prevById.get(Number(shot.item_id));
      if (!old) continue;
      let nid: number | null = old.barcode ? (newByBarcode.get(old.barcode) ?? null) : null;
      if (nid == null) {
        const key = old.name.toLowerCase().trim();
        nid = newByName.get(key) ?? null;
        if (nid == null) {
          for (const [name, id] of newByName) {
            if (name.includes(key) || key.includes(name)) {
              nid = id;
              break;
            }
          }
        }
      }
      if (nid != null) {
        await sql`update scan_shots set item_id = ${nid} where id = ${shot.id}`;
      }
    }

    const orphans = await sql<{ id: number; last_read_json: string | null }>`
      select id, last_read_json from scan_shots
       where trip_id = ${tripId} and kind = 'label' and item_id is null
    `;
    for (const orphan of orphans) {
      let name = "";
      try {
        const last = orphan.last_read_json ? JSON.parse(orphan.last_read_json) : null;
        name = typeof last?.name === "string" ? last.name.toLowerCase().trim() : "";
      } catch {
        name = "";
      }
      if (!name) continue;
      let nid = newByName.get(name) ?? null;
      if (nid == null) {
        for (const [n, id] of newByName) {
          if (n.includes(name) || name.includes(n)) {
            nid = id;
            break;
          }
        }
      }
      if (nid != null) {
        await sql`update scan_shots set item_id = ${nid} where id = ${orphan.id}`;
      }
    }

    await sql`
      update trips
         set status = 'review',
             store_name = coalesce(${collated.data.storeName}, store_name),
             store_location = coalesce(${collated.data.storeLocation}, store_location),
             receipt_subtotal = ${collated.data.subtotal},
             receipt_tax = ${collated.data.tax},
             receipt_total = ${collated.data.total},
             currency = ${collated.data.currency},
             notes = coalesce(${collated.data.notes}, notes)
       where id = ${tripId}
    `;

    const next = await loadTrip(tripId);
    if (!next) throw new Error("Trip not found");
    return {
      trip: next,
      items: await loadItems(tripId),
      receipts: await loadReceipts(tripId),
      shots: await loadShots(tripId),
      usedLocalCollate: collated.usedLocalCollate,
    };
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
      currency, thumbnail_data, match_status, match_confidence
    ) values (
      ${OWNER}, ${tripId}, 'merged', ${item.name}, ${item.brand}, ${item.description},
      ${item.barcode}, ${item.category}, ${item.quantity}, ${item.quantityUnit},
      ${item.weightValue}, ${item.weightUnit}, ${item.unitPrice}, ${item.linePrice},
      ${item.currency}, ${item.thumbnailData}, ${item.matchStatus}, ${item.matchConfidence}
    )
    returning id
  `;
  return Number(rows[0]?.id ?? 0);
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
        ${OWNER}, ${data.tripId}, ${data.kind}, ${data.imageData}, ${data.thumbnailData ?? null},
        ${data.barcode ?? null}, ${data.itemId ?? null}, ${data.captureId ?? null}, ${json}
      )
      returning id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
    `;
    if (!rows[0]) throw new Error("Could not save photo");
    return mapShot(rows[0]);
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
    const barcode = data.barcode === undefined ? row.barcode : data.barcode;
    const itemId = data.itemId === undefined ? row.item_id : data.itemId;
    const captureId = data.captureId === undefined ? row.capture_id : data.captureId;
    const rows = data.imageData
      ? await sql<ShotRow>`
          update scan_shots
             set image_data = ${data.imageData},
                 thumbnail_data = ${thumb},
                 barcode = ${barcode},
                 item_id = ${itemId},
                 capture_id = ${captureId},
                 last_read_json = ${json}
           where id = ${data.shotId}
           returning id, trip_id, kind, thumbnail_data, barcode, item_id, capture_id, last_read_json, created_at
        `
      : await sql<ShotRow>`
          update scan_shots
             set thumbnail_data = ${thumb},
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
    return { image: row.image_data, shot: mapShot(row) };
  });

export const deleteScanShot = createServerFn({ method: "POST" })
  .validator((shotId: number) => shotId)
  .handler(async ({ data: shotId }): Promise<{ ok: true }> => {
    const sql = await getSql();
    await sql`delete from scan_shots where id = ${shotId}`;
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
    return trip;
  });

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

export const getLlmConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { loadLlmConfig } = await import("./llm");
  return loadLlmConfig();
});

export const saveLlmConfig = createServerFn({ method: "POST" })
  .validator(
    (input: {
      localUrl?: string | null;
      visionModel?: string | null;
      textModel?: string | null;
      apiKey?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { saveLlmConfig: persist } = await import("./llm");
    return persist(data);
  });
