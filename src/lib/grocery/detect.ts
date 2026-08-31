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

/** Read a barcode from a snapped photo. Not used to auto-fire the shutter. */
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