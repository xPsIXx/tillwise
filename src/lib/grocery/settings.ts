import type { LlmProvider } from "./types";

export type ReadMode = "local" | "ppocr" | "byok" | "grok" | "device";
export type VisionDetail = "low" | "high";
export type PpocrFeel = "loose" | "normal" | "strict";
export type PpocrSize = "tiny" | "small" | "medium";

export type ScanSettings = {
  read: ReadMode;
  collate: LlmProvider;
  autoAdd: boolean;
  debugSamples: boolean;
  visionDetail: VisionDetail;
  ppocrFeel: PpocrFeel;
  ppocrDetSize: PpocrSize;
  ppocrRecSize: PpocrSize;
};

export const PPOCR_SIZES: { id: PpocrSize; title: string; body: string }[] = [
  {
    id: "tiny",
    title: "Tiny",
    body: "Fastest (~1.5M). Weaker on small English type.",
  },
  {
    id: "small",
    title: "Small",
    body: "Balanced (~8M). Default. Finds the text boxes, then reads them.",
  },
  {
    id: "medium",
    title: "Medium",
    body: "Sharpest (~35M). Slow to compile. Use when stickers are dense or faint.",
  },
];

export const READ_OPTIONS: { id: ReadMode; title: string; body: string }[] = [
  {
    id: "ppocr",
    title: "PP-OCRv6 on-device",
    body: "On this phone after a Hugging Face download. Reads in the background when “Add to cart, fill in later” is on. Weak on till tape — receipts still use a vision LLM.",
  },
  {
    id: "byok",
    title: "BYOK vision",
    body: "Your cloud or remote API. Paste an OpenAI-compatible endpoint, vision model, and API key below. Snaps file immediately and read in the background — no confirm sheet.",
  },
];

export const COLLATE_OPTIONS: { id: LlmProvider; title: string; body: string }[] = [
  {
    id: "local",
    title: "Local text LLM",
    body: "Your server. TEXT_MODEL groups aisle names with till abbreviations (TOM VINE → tomatoes on the vine).",
  },
  {
    id: "byok",
    title: "BYOK text",
    body: "Same remote API as vision, using the text model you set. Use when you do not have a local collate model.",
  },
];

const KEY = "tillwise.scan-settings";

const DEFAULTS: ScanSettings = {
  read: "ppocr",
  collate: "local",
  autoAdd: true,
  debugSamples: false,
  visionDetail: "high",
  ppocrFeel: "loose",
  ppocrDetSize: "tiny",
  ppocrRecSize: "small",
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

const READS: ReadMode[] = ["local", "ppocr", "byok", "grok", "device"];
const SIZES: PpocrSize[] = ["tiny", "small", "medium"];

function asSize(v: unknown, fallback: PpocrSize): PpocrSize {
  return SIZES.includes(v as PpocrSize) ? (v as PpocrSize) : fallback;
}

export function loadScanSettings(): ScanSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ScanSettings> & { v?: number };
    const feel: PpocrFeel =
      parsed.ppocrFeel === "normal" || parsed.ppocrFeel === "strict" || parsed.ppocrFeel === "loose"
        ? parsed.ppocrFeel
        : DEFAULTS.ppocrFeel;
    let read: ReadMode = READS.includes(parsed.read as ReadMode)
      ? (parsed.read as ReadMode)
      : DEFAULTS.read;
    if (read === "grok" || read === "local" || read === "device") read = read === "grok" ? "byok" : "ppocr";
    if (read !== "ppocr" && read !== "byok") read = DEFAULTS.read;
    return {
      read,
      collate: parsed.collate === "byok" || parsed.collate === "grok" ? "byok" : "local",
      autoAdd: parsed.autoAdd ?? DEFAULTS.autoAdd,
      debugSamples: Boolean(parsed.debugSamples),
      visionDetail: parsed.visionDetail === "low" ? "low" : "high",
      ppocrFeel: feel,
      ppocrDetSize: asSize(parsed.ppocrDetSize, DEFAULTS.ppocrDetSize),
      ppocrRecSize: asSize(parsed.ppocrDetSize, DEFAULTS.ppocrDetSize),
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveScanSettings(next: ScanSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ ...next, ppocrRecSize: next.ppocrDetSize, v: 6 }),
  );
}

/** Vision LLMs skip the confirm sheet — they file and read in the background. */
export function holdForLook(cfg: ScanSettings): boolean {
  if (cfg.autoAdd) return false;
  if (cfg.read === "local" || cfg.read === "byok" || cfg.read === "grok") return false;
  return true;
}

export function effectiveRead(
  cfg: ScanSettings,
  llm?: { localAvailable: boolean; byokAvailable?: boolean; grokAvailable?: boolean },
): ReadMode {
  if (cfg.read === "local" && llm && !llm.localAvailable) return "ppocr";
  if (
    (cfg.read === "byok" || cfg.read === "grok") &&
    llm &&
    !(llm.byokAvailable ?? llm.grokAvailable)
  ) {
    return "ppocr";
  }
  return cfg.read === "grok" ? "byok" : cfg.read;
}

/** LLM used for label/receipt photos that need a vision model. */
export function visionProvider(cfg: ScanSettings): LlmProvider {
  if (cfg.read === "byok" || cfg.read === "grok") return "byok";
  if (cfg.read === "local") return "local";
  return cfg.collate === "grok" ? "byok" : cfg.collate;
}
