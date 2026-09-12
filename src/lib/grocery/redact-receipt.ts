import type { PiiBox } from "./types";

/** Black out shopper PII. Uses vision boxes from the till read when present; else the footer. Original on disk is not touched. */
export async function redactReceiptPii(dataUrl: string, boxes?: PiiBox[] | null): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#141414";
  const usable = (boxes ?? [])
    .map((b) => normalizeBox(b, img.width, img.height))
    .filter((b) => b.w > 0.02 && b.h > 0.02 && b.w * b.h <= 0.45);
  if (usable.length > 0) {
    const pad = 0.03;
    for (const b of usable) {
      const x = Math.max(0, b.x - pad) * img.width;
      const y = Math.max(0, b.y - pad) * img.height;
      const w = Math.min(img.width - x, (b.w + pad * 2) * img.width);
      const h = Math.min(img.height - y, (b.h + pad * 2) * img.height);
      ctx.fillRect(x, y, w, h);
    }
  } else {
    const footer = Math.round(Math.max(120, Math.min(img.height * 0.24, img.width * 1.15)));
    ctx.fillRect(0, img.height - footer, img.width, footer);
  }
  ctx.fillStyle = "#2a2a2a";
  ctx.font = `${Math.max(14, Math.round(img.width * 0.045))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("card / loyalty hidden", img.width / 2, img.height - Math.max(24, img.width * 0.06));
  return canvas.toDataURL("image/jpeg", 0.86);
}

function normalizeBox(b: PiiBox, width: number, height: number): PiiBox {
  let { x, y, w, h } = b;
  const max = Math.max(x, y, w, h);
  if (max > 1.5 && max <= 100) {
    x /= 100;
    y /= 100;
    w /= 100;
    h /= 100;
  } else if (max > 100) {
    x /= width;
    y /= height;
    w /= width;
    h /= height;
  }
  return { kind: b.kind, x, y, w, h };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read till photo"));
    img.src = src;
  });
}
