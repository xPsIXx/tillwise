import type { Sql } from "@/lib/db";
import { recordAction } from "@/lib/action-log";
import {
  isDataUrl,
  writeItemThumb,
  writeReceiptThumb,
  writeShotImage,
  writeShotThumb,
} from "@/lib/photo-store";

let running = false;

async function leftoverDataUrls(sql: Sql): Promise<number> {
  const rows = await sql.query<{ n: number }>(
    `select
       (select count(*) from scan_shots
         where image_data like 'data:%' or coalesce(thumbnail_data, '') like 'data:%')
       + (select count(*) from trip_items
         where coalesce(thumbnail_data, '') like 'data:%')
       + (select count(*) from receipt_captures
         where coalesce(thumbnail_data, '') like 'data:%')
       as n`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** On boot: copy data-URL photos to /data/photos and leave a path in PGLite. No-op if none. */
export async function migratePhotosOutOfDb(sql: Sql): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await leftoverDataUrls(sql);
    if (pending === 0) {
      console.info("[photos] none left in the ledger");
      return;
    }
    console.info(`[photos] moving ${pending} image column(s) to /data/photos`);
    let moved = 0;
    for (;;) {
      const shots = await sql<{
        id: number;
        image_data: string;
        thumbnail_data: string | null;
      }>`
        select id, image_data, thumbnail_data from scan_shots
         where image_data like 'data:%' or coalesce(thumbnail_data, '') like 'data:%'
         limit 6
      `;
      if (!shots.length) break;
      for (const row of shots) {
        const image = isDataUrl(row.image_data) ? writeShotImage(row.id, row.image_data) : row.image_data;
        const thumb = isDataUrl(row.thumbnail_data)
          ? writeShotThumb(row.id, row.thumbnail_data)
          : row.thumbnail_data;
        await sql`
          update scan_shots
             set image_data = ${image}, thumbnail_data = ${thumb}
           where id = ${row.id}
        `;
        moved += 1;
      }
    }
    for (;;) {
      const items = await sql<{ id: number; thumbnail_data: string }>`
        select id, thumbnail_data from trip_items
         where coalesce(thumbnail_data, '') like 'data:%'
         limit 12
      `;
      if (!items.length) break;
      for (const row of items) {
        const thumb = writeItemThumb(row.id, row.thumbnail_data);
        await sql`update trip_items set thumbnail_data = ${thumb} where id = ${row.id}`;
        moved += 1;
      }
    }
    for (;;) {
      const caps = await sql<{ id: number; thumbnail_data: string }>`
        select id, thumbnail_data from receipt_captures
         where coalesce(thumbnail_data, '') like 'data:%'
         limit 12
      `;
      if (!caps.length) break;
      for (const row of caps) {
        const thumb = writeReceiptThumb(row.id, row.thumbnail_data);
        await sql`update receipt_captures set thumbnail_data = ${thumb} where id = ${row.id}`;
        moved += 1;
      }
    }
    console.info(`[photos] moved ${moved} image column(s) out of the ledger`);
    recordAction({ action: "migratePhotosOutOfDb", ok: true, detail: `moved ${moved}` });
  } catch (err) {
    console.error("[photos] migrate failed", err);
    recordAction({
      action: "migratePhotosOutOfDb",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}
