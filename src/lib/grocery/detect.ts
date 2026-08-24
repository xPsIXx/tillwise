import type { ScanMode } from "./types";

export type FrameHint = {
  focused: boolean;
  aligned: boolean;
  barcode: string | null;
  score: number;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
};

let detector: BarcodeDetectorLike | null | undefined;

function getDetector(): BarcodeDetectorLike | null {
  if (detector !== undefined) return detector;
  const Ctor = (
    globalThis as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) {
    detector = null;
    return detector;
  }
  try {
    detector = new Ctor({
      formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
    });
  } catch {
    detector = null;
  }
  return detector;
}

export async function detectBarcode(
  source: ImageBitmapSource,
): Promise<string | null> {
  const det = getDetector();
  if (!det) return null;
  try {
    const codes = await det.detect(source);
    return codes[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

export function scoreFrame(data: ImageData, mode: ScanMode): FrameHint {
  const { width, height, data: px } = data;
  const insetX = Math.floor(width * 0.14);
  const insetY = Math.floor(height * (mode === "receipt" ? 0.12 : 0.18));
  const boxW = Math.floor(width * 0.72);
  const boxH = Math.floor(height * (mode === "receipt" ? 0.72 : 0.52));

  let grad = 0;
  let n = 0;
  const step = 5;
  for (let y = insetY; y < insetY + boxH && y < height - 1; y += step) {
    for (let x = insetX; x < insetX + boxW && x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const j = (y * width + Math.min(width - 1, x + step)) * 4;
      const k = (Math.min(height - 1, y + step) * width + x) * 4;
      const g1 = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
      const g2 = px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11;
      const g3 = px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
      grad += Math.abs(g1 - g2) + Math.abs(g1 - g3);
      n += 1;
    }
  }
  const focus = n ? grad / n : 0;
  const focused = focus > 16;

  const edge = sampleEdge(px, width, height, insetX, insetY, boxW, boxH);
  const aligned = edge > 12;

  const score = Math.max(
    0,
    Math.min(1, focus / 40) * 0.65 + Math.max(0, Math.min(1, edge / 28)) * 0.35,
  );

  return { focused, aligned, barcode: null, score };
}

function sampleEdge(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  const lum = (cx: number, cy: number) => {
    const xx = Math.max(0, Math.min(width - 1, cx));
    const yy = Math.max(0, Math.min(height - 1, cy));
    const i = (yy * width + xx) * 4;
    return px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  };
  let sum = 0;
  let n = 0;
  const step = 6;
  for (let i = 0; i < w; i += step) {
    sum += Math.abs(lum(x + i, y) - lum(x + i, y + 8));
    sum += Math.abs(lum(x + i, y + h) - lum(x + i, y + h - 8));
    n += 2;
  }
  for (let i = 0; i < h; i += step) {
    sum += Math.abs(lum(x, y + i) - lum(x + 8, y + i));
    sum += Math.abs(lum(x + w, y + i) - lum(x + w - 8, y + i));
    n += 2;
  }
  return n ? sum / n : 0;
}

export class StabilityGate {
  private hits = 0;
  private lastFire = 0;
  private readonly need: number;
  private readonly cooldownMs: number;

  constructor(need = 5, cooldownMs = 2400) {
    this.need = need;
    this.cooldownMs = cooldownMs;
  }

  update(ready: boolean): boolean {
    if (!ready) {
      this.hits = Math.max(0, this.hits - 2);
      return false;
    }
    this.hits += 1;
    const now = Date.now();
    if (this.hits >= this.need && now - this.lastFire > this.cooldownMs) {
      this.hits = 0;
      this.lastFire = now;
      return true;
    }
    return false;
  }

  reset() {
    this.hits = 0;
  }
}
