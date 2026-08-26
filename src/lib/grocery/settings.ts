import type { LlmProvider } from "./types";

export type DetectMode = "tensorflow" | "ppocr" | "shape" | "barcode" | "off";
export type ReadMode = "local" | "ppocr" | "grok" | "device";
export type VisionDetail = "low" | "high";
export type PpocrFeel = "loose" | "normal" | "strict";

export type ScanSettings = {
  detect: DetectMode;
  read: ReadMode;
  collate: LlmProvider;
  autoCapture: boolean;
  autoAdd: boolean;
  confidence: number;
  visionDetail: VisionDetail;
  ppocrFeel: PpocrFeel;
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
    body: "On this phone. Finds text in the aim box. First enable downloads from Hugging Face (~30 MB) then compiles WASM — keep this tab open. Cached after that.",
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
  read: "ppocr",
  collate: "local",
  autoCapture: true,
  autoAdd: true,
  confidence: 0.28,
  visionDetail: "high",
  ppocrFeel: "loose",
};

export const PPOCR_FEEL: { id: PpocrFeel; title: string; body: string }[] = [
  {
    id: "loose",
    title: "Loose",
    body: "Accept faint or small sticker text. Best for produce scales and far-away labels.",
  },
  {
    id: "normal",
    title: "Normal",
    body: "Ignore junk in the margins. Default if Loose picks up shelf talkers.",
  },
  {
    id: "strict",
    title: "Strict",
    body: "Only lock on sharp text in the aim box. Use when the aisle is busy.",
  },
];

export function ppocrParams(feel: PpocrFeel) {
  if (feel === "strict") {
    return {
      recThresh: 0.45,
      detThresh: 0.35,
      boxThresh: 0.55,
      reticle: 0.28,
      minScore: 0.42,
      minLen: 2,
    };
  }
  if (feel === "normal") {
    return {
      recThresh: 0.28,
      detThresh: 0.25,
      boxThresh: 0.45,
      reticle: 0.18,
      minScore: 0.28,
      minLen: 2,
    };
  }
  return {
    recThresh: 0.12,
    detThresh: 0.18,
    boxThresh: 0.35,
    reticle: 0.08,
    minScore: 0.15,
    minLen: 1,
  };
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return DEFAULTS.confidence;
  return Math.min(0.85, Math.max(0.1, n));
}

const DETECTS: DetectMode[] = ["tensorflow", "ppocr", "shape", "barcode", "off"];
const READS: ReadMode[] = ["local", "ppocr", "grok", "device"];

export function loadScanSettings(): ScanSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ScanSettings> & { v?: number };
    const version = Number(parsed.v ?? 0);
    const feel: PpocrFeel =
      parsed.ppocrFeel === "normal" || parsed.ppocrFeel === "strict" || parsed.ppocrFeel === "loose"
        ? parsed.ppocrFeel
        : DEFAULTS.ppocrFeel;
    let read: ReadMode = READS.includes(parsed.read as ReadMode)
      ? (parsed.read as ReadMode)
      : DEFAULTS.read;
    // v1 defaulted to local vision. With no model that path is dead — prefer PP-OCR.
    if (version < 2 && read === "local") read = "ppocr";
    return {
      detect: DETECTS.includes(parsed.detect as DetectMode)
        ? (parsed.detect as DetectMode)
        : DEFAULTS.detect,
      read,
      collate: parsed.collate === "grok" ? "grok" : "local",
      autoCapture: parsed.autoCapture ?? DEFAULTS.autoCapture,
      autoAdd: parsed.autoAdd ?? DEFAULTS.autoAdd,
      confidence: clampConfidence(Number(parsed.confidence ?? DEFAULTS.confidence)),
      visionDetail: parsed.visionDetail === "low" ? "low" : "high",
      ppocrFeel: feel,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveScanSettings(next: ScanSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify({ ...next, v: 2 }));
}

export function effectiveRead(
  cfg: ScanSettings,
  llm?: { localAvailable: boolean; grokAvailable: boolean },
): ReadMode {
  if (cfg.read === "local" && llm && !llm.localAvailable) return "ppocr";
  if (cfg.read === "grok" && llm && !llm.grokAvailable) return "ppocr";
  return cfg.read;
}

/** LLM used for label/receipt photos that need a vision model. */
export function visionProvider(cfg: ScanSettings): LlmProvider {
  if (cfg.read === "grok") return "grok";
  if (cfg.read === "local") return "local";
  return cfg.collate;
}
