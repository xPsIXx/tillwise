import type { LlmProvider } from "./types";

export type DetectMode = "tensorflow" | "ppocr" | "shape" | "barcode" | "off";
export type ReadMode = "local" | "ppocr" | "grok" | "device";
export type VisionDetail = "low" | "high";

export type ScanSettings = {
  detect: DetectMode;
  read: ReadMode;
  collate: LlmProvider;
  autoCapture: boolean;
  autoAdd: boolean;
  confidence: number;
  visionDetail: VisionDetail;
};

export const DETECT_OPTIONS: { id: DetectMode; title: string; body: string }[] = [
  {
    id: "tensorflow",
    title: "TensorFlow.js",
    body: "On this phone. MobileNet (~5–10 MB from the CDN) scores the frame, then we snap. Same path as your Unraid scanner.",
  },
  {
    id: "ppocr",
    title: "PP-OCRv6",
    body: "On this phone. Finds text in the aim box. First enable downloads PP-OCRv6 from Hugging Face (~30 MB), then it stays cached.",
  },
  {
    id: "shape",
    title: "Shape + barcode",
    body: "On this phone, no download. Lock when a sticker rectangle is sharp, or a barcode is in frame.",
  },
  {
    id: "barcode",
    title: "Barcode only",
    body: "On this phone: wait for EAN / UPC / Code 128. Best for packaged goods.",
  },
  {
    id: "off",
    title: "Manual shutter",
    body: "You tap. Detection still draws the aim box, but never fires on its own.",
  },
];

export const READ_OPTIONS: { id: ReadMode; title: string; body: string }[] = [
  {
    id: "local",
    title: "Local vision LLM",
    body: "Your server. OpenAI-compatible /v1/chat/completions at LLM_BASE_URL, model VISION_MODEL. Same as Qwen3-VL on llama-swap.",
  },
  {
    id: "ppocr",
    title: "PP-OCRv6 on-device",
    body: "Stays on the phone after a Hugging Face download: det + rec, then regex for name / kg / AED. Weak on till tape — receipts still use a vision LLM.",
  },
  {
    id: "grok",
    title: "Grok vision",
    body: "Off-device. grok-4.5 via xAI. Strong on messy stickers and till tape.",
  },
  {
    id: "device",
    title: "Browser text",
    body: "Text Detector API + regex. Thin fallback if PP-OCR is not loaded.",
  },
];

export const COLLATE_OPTIONS: { id: LlmProvider; title: string; body: string }[] = [
  {
    id: "local",
    title: "Local text LLM",
    body: "Your server. TEXT_MODEL groups aisle names with till abbreviations (TOM VINE → tomatoes on the vine).",
  },
  {
    id: "grok",
    title: "Grok",
    body: "Off-device grok-4.5. Use when the local text model is down.",
  },
];

const KEY = "tillwise.scan-settings";

const DEFAULTS: ScanSettings = {
  detect: "shape",
  read: "local",
  collate: "local",
  autoCapture: true,
  autoAdd: true,
  confidence: 0.42,
  visionDetail: "high",
};

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.confidence;
  return Math.min(0.85, Math.max(0.2, n));
}

const DETECTS: DetectMode[] = ["tensorflow", "ppocr", "shape", "barcode", "off"];
const READS: ReadMode[] = ["local", "ppocr", "grok", "device"];

export function loadScanSettings(): ScanSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ScanSettings>;
    return {
      detect: DETECTS.includes(parsed.detect as DetectMode)
        ? (parsed.detect as DetectMode)
        : DEFAULTS.detect,
      read: READS.includes(parsed.read as ReadMode) ? (parsed.read as ReadMode) : DEFAULTS.read,
      collate: parsed.collate === "grok" ? "grok" : "local",
      autoCapture: parsed.autoCapture ?? DEFAULTS.autoCapture,
      autoAdd: parsed.autoAdd ?? DEFAULTS.autoAdd,
      confidence: clampConfidence(Number(parsed.confidence)),
      visionDetail: parsed.visionDetail === "low" ? "low" : "high",
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveScanSettings(next: ScanSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

/** LLM used for label/receipt photos that need a vision model. */
export function visionProvider(cfg: ScanSettings): LlmProvider {
  if (cfg.read === "grok") return "grok";
  if (cfg.read === "local") return "local";
  return cfg.collate;
}
