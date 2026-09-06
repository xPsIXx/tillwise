import { getSql } from "@/lib/db";
import {
  bufferToDataUrl,
  isDataUrl,
  readFileRef,
  writeItemThumb,
  writeReceiptThumb,
  writeShotImage,
  writeShotThumb,
} from "@/lib/photo-store";

function jpegResponse(buf: Buffer): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=60",
    },
  });
}

function dataUrlToBuffer(data: string): Buffer | null {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(data);
  if (!m?.[2]) return null;
  return Buffer.from(m[2], "base64");
}

export async function handleMediaRequest(pathname: string): Promise<Response | null> {
  const shotFull = /^\/media\/shot\/(\d+)$/.exec(pathname);
  const shotThumb = /^\/media\/shot\/(\d+)\/thumb$/.exec(pathname);
  const itemThumb = /^\/media\/item\/(\d+)\/thumb$/.exec(pathname);
  const receiptThumb = /^\/media\/receipt\/(\d+)\/thumb$/.exec(pathname);

  try {
    if (shotFull || shotThumb) {
      const id = Number((shotFull ?? shotThumb)?.[1]);
      const sql = await getSql();
      const rows = await sql<{ image_data: string; thumbnail_data: string | null }>`
        select image_data, thumbnail_data from scan_shots where id = ${id} limit 1
      `;
      const row = rows[0];
      if (!row) return new Response("Not found", { status: 404 });
      const wantThumb = Boolean(shotThumb);
      let stored = wantThumb ? row.thumbnail_data || row.image_data : row.image_data;
      if (isDataUrl(stored)) {
        if (wantThumb) {
          stored = writeShotThumb(id, row.thumbnail_data && isDataUrl(row.thumbnail_data) ? row.thumbnail_data : stored);
          await sql`update scan_shots set thumbnail_data = ${stored} where id = ${id}`;
        } else {
          stored = writeShotImage(id, row.image_data);
          await sql`update scan_shots set image_data = ${stored} where id = ${id}`;
        }
      }
      const fromFile = stored ? readFileRef(stored) : null;
      if (fromFile) return jpegResponse(fromFile);
      const fromData = stored && isDataUrl(stored) ? dataUrlToBuffer(stored) : null;
      if (fromData) return jpegResponse(fromData);
      return new Response("Not found", { status: 404 });
    }

    if (itemThumb) {
      const id = Number(itemThumb[1]);
      const sql = await getSql();
      const rows = await sql<{ thumbnail_data: string | null }>`
        select thumbnail_data from trip_items where id = ${id} limit 1
      `;
      const stored0 = rows[0]?.thumbnail_data ?? null;
      if (!stored0) return new Response("Not found", { status: 404 });
      let stored = stored0;
      if (isDataUrl(stored)) {
        stored = writeItemThumb(id, stored);
        await sql`update trip_items set thumbnail_data = ${stored} where id = ${id}`;
      }
      const fromFile = readFileRef(stored);
      if (fromFile) return jpegResponse(fromFile);
      const fromData = isDataUrl(stored0) ? dataUrlToBuffer(stored0) : null;
      if (fromData) return jpegResponse(fromData);
      return new Response("Not found", { status: 404 });
    }

    if (receiptThumb) {
      const id = Number(receiptThumb[1]);
      const sql = await getSql();
      const rows = await sql<{ thumbnail_data: string | null }>`
        select thumbnail_data from receipt_captures where id = ${id} limit 1
      `;
      const stored0 = rows[0]?.thumbnail_data ?? null;
      if (!stored0) return new Response("Not found", { status: 404 });
      let stored = stored0;
      if (isDataUrl(stored)) {
        stored = writeReceiptThumb(id, stored);
        await sql`update receipt_captures set thumbnail_data = ${stored} where id = ${id}`;
      }
      const fromFile = readFileRef(stored);
      if (fromFile) return jpegResponse(fromFile);
      const fromData = isDataUrl(stored0) ? dataUrlToBuffer(stored0) : null;
      if (fromData) return jpegResponse(fromData);
      return new Response("Not found", { status: 404 });
    }
  } catch (err) {
    console.error("[media]", err);
    return new Response("Error", { status: 500 });
  }
  return null;
}

export async function storedToDataUrl(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (isDataUrl(stored)) return stored;
  const buf = readFileRef(stored);
  if (buf) return bufferToDataUrl(buf);
  return null;
}
