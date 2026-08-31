import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CameraOff,
  Flashlight,
  FlashlightOff,
  ImagePlus,
  LoaderCircle,
  ScanLine,
  SlidersHorizontal,
  SwitchCamera,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { detectBarcode } from "@/lib/grocery/detect";
import {
  blobToDataUrl,
  captureCanvas,
  cropVideo,
  imageToCanvas,
  LABEL_CAPTURE,
  LABEL_VIEWFINDER,
  loadImage,
  makeThumbnail,
  publicImageToDataUrl,
  RECEIPT_CAPTURE,
} from "@/lib/grocery/image";
import { extractionConfidence, extractionIsThin, readLabelOnDevice } from "@/lib/grocery/parse-local";
import { loadPpocr, parsePpocrText, ppocrReady, runPpocr } from "@/lib/grocery/ppocr";
import { SAMPLE_LABELS, SAMPLE_RECEIPTS } from "@/lib/grocery/sample-data";
import { fillFromMemory } from "@/lib/grocery/catalog";
import {
  READ_OPTIONS,
  effectiveRead,
  holdForLook,
  loadScanSettings,
  saveScanSettings,
  visionProvider,
  type ScanSettings,
} from "@/lib/grocery/settings";
import { type EngineProgress } from "@/lib/grocery/tfjs";
import {
  addLabelItem,
  addReceiptCapture,
  addScanShot,
  getLlmConfig,
  lookupProduct,
  scanLabelPhoto,
  scanReceiptPhoto,
  updateItem,
  updateReceiptCapture,
  updateScanShot,
} from "@/lib/grocery/server";
import type { LabelExtraction, ReceiptExtraction, ScanMode } from "@/lib/grocery/types";
import { money, qty, weight } from "@/lib/grocery/format";
import { cn } from "@/lib/utils";

type Pending =
  | { kind: "label"; image: string; data: LabelExtraction; itemId?: number; shotId?: number }
  | { kind: "receipt"; image: string; data: ReceiptExtraction; captureId?: number; shotId?: number };

type Job = {
  id: string;
  mode: ScanMode;
  image: string;
  barcode: string | null;
  status: "queued" | "reading" | "done" | "error";
  itemId?: number;
  captureId?: number;
  shotId?: number;
  error?: string;
  confidence?: number | null;
};

type JobBag = {
  jobs: Job[];
  running: number;
  claimed: Set<string>;
};

function jobBag(): JobBag {
  const g = globalThis as typeof globalThis & { __tillwiseScanJobs?: JobBag };
  if (!g.__tillwiseScanJobs) {
    g.__tillwiseScanJobs = { jobs: [], running: 0, claimed: new Set() };
  }
  return g.__tillwiseScanJobs;
}

const PLACEHOLDER_LABEL: LabelExtraction = {
  name: "Reading label…",
  brand: null,
  description: null,
  barcode: null,
  category: null,
  quantity: null,
  quantityUnit: null,
  weightValue: null,
  weightUnit: null,
  unitPrice: null,
  linePrice: null,
  currency: null,
  origin: null,
  rawText: "",
};

function emptyReceipt(): ReceiptExtraction {
  return {
    storeName: null,
    storeLocation: null,
    datetime: null,
    isPartial: true,
    portionHint: null,
    items: [],
    subtotal: null,
    tax: null,
    total: null,
    currency: null,
    rawText: "",
  };
}

type CameraStatus = "starting" | "live" | "denied" | "error";

let sharedStream: MediaStream | null = null;
let sharedAcquire: Promise<MediaStream> | null = null;
let cameraHolders = 0;
let cameraReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function streamIsLive(stream: MediaStream | null): stream is MediaStream {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));
}

function trackLabel(stream: MediaStream): string {
  return stream.getVideoTracks()[0]?.label ?? "";
}

function trackFacing(stream: MediaStream): string | undefined {
  try {
    return stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  } catch {
    return undefined;
  }
}

function isFrontFacing(stream: MediaStream): boolean {
  const facing = trackFacing(stream);
  if (facing === "user") return true;
  if (facing === "environment") return false;
  const label = trackLabel(stream);
  // Do not match the substring "face" inside "facing back".
  if (/facing\s*back|back camera|rear camera|\brear\b|environment|world/i.test(label)) {
    return false;
  }
  return /facing\s*front|front camera|selfie|facetime/i.test(label);
}

function isRearDevice(info: MediaDeviceInfo): boolean {
  const label = info.label || "";
  if (/facing\s*front|front camera|selfie|facetime/i.test(label)) return false;
  return /facing\s*back|back camera|rear camera|\brear\b|environment|world/i.test(label);
}

async function rearCameraId(): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput",
    );
    const named = cams.find(isRearDevice);
    if (named?.deviceId) return named.deviceId;
    return null;
  } catch {
    return null;
  }
}

async function openCamera(facing: "environment" | "user"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera API missing", "NotSupportedError");
  }
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    { audio: false, video: { facingMode: { ideal: facing } } },
    { audio: false, video: { facingMode: facing } },
  ];

  let last: unknown;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getVideoTracks().forEach((t) => {
        t.enabled = true;
      });
      if (facing === "environment" && isFrontFacing(stream)) {
        stream.getTracks().forEach((t) => t.stop());
        continue;
      }
      return stream;
    } catch (err) {
      last = err;
    }
  }

  if (facing === "environment") {
    const deviceId = await rearCameraId();
    if (deviceId) {
      try {
        const byId = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: deviceId } },
        });
        byId.getVideoTracks().forEach((t) => {
          t.enabled = true;
        });
        if (!isFrontFacing(byId)) return byId;
        byId.getTracks().forEach((t) => t.stop());
      } catch (err) {
        last = err;
      }
    }
  }

  throw last instanceof Error ? last : new Error("Camera failed");
}

function bindVideo(stream: MediaStream, video: HTMLVideoElement | null) {
  if (!video) return false;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("autoplay", "true");
  video.setAttribute("muted", "true");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  const track = stream.getVideoTracks()[0];
  if (track) track.enabled = true;
  if (video.srcObject !== stream) video.srcObject = stream;
  void video.play().catch(() => undefined);
  return true;
}

function waitForFrame(video: HTMLVideoElement, stream: MediaStream, ms = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const track = stream.getVideoTracks()[0];
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      video.removeEventListener("playing", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("loadedmetadata", check);
      track?.removeEventListener("unmute", check);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const check = () => {
      if (video.videoWidth > 2 && video.videoHeight > 2) finish(true);
    };
    video.addEventListener("playing", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("loadedmetadata", check);
    track?.addEventListener("unmute", check);
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => finish(true));
    }
    const timer = window.setTimeout(() => finish(video.videoWidth > 2), ms);
    void video.play().then(check).catch(() => undefined);
    check();
  });
}

function acquireCamera(fresh = false, facing: "environment" | "user" = "environment"): Promise<MediaStream> {
  if (
    !fresh &&
    streamIsLive(sharedStream) &&
    !(facing === "environment" && isFrontFacing(sharedStream))
  ) {
    return Promise.resolve(sharedStream);
  }
  if (!fresh && sharedAcquire) return sharedAcquire;
  const previous = sharedStream;
  sharedAcquire = openCamera(facing)
    .then((stream) => {
      if (previous && previous !== stream) previous.getTracks().forEach((t) => t.stop());
      sharedStream = stream;
      return stream;
    })
    .finally(() => {
      sharedAcquire = null;
    });
  return sharedAcquire;
}

function holdCamera() {
  cameraHolders += 1;
  if (cameraReleaseTimer) {
    clearTimeout(cameraReleaseTimer);
    cameraReleaseTimer = null;
  }
}

function releaseCameraSoon() {
  cameraHolders = Math.max(0, cameraHolders - 1);
  if (cameraHolders > 0) return;
  if (cameraReleaseTimer) clearTimeout(cameraReleaseTimer);
  cameraReleaseTimer = setTimeout(() => {
    if (cameraHolders > 0) return;
    sharedStream?.getTracks().forEach((t) => t.stop());
    sharedStream = null;
    cameraReleaseTimer = null;
  }, 800);
}

export function CameraView({
  tripId,
  mode,
  onMode,
  onClose,
  onSaved,
}: {
  tripId: number;
  mode: ScanMode;
  onMode: (mode: ScanMode) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const snapLock = useRef(false);
  const settingsRef = useRef<ScanSettings>(loadScanSettings());
  const [scanCfg, setScanCfg] = useState<ScanSettings>(() => settingsRef.current);
  const [camera, setCamera] = useState<CameraStatus>("starting");
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState("Frame a label");
  const [flash, setFlash] = useState(false);
  const [jobs, setJobs] = useState<Job[]>(() => [...jobBag().jobs]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [engine, setEngine] = useState<EngineProgress | null>(null);
  const [readerWarn, setReaderWarn] = useState<string | null>(null);

  const start = useCallback(async (fresh = false) => {
    setCamera((c) => (c === "live" && !fresh ? c : "starting"));
    try {
      const stream = await acquireCamera(fresh, "environment");
      streamRef.current = stream;
      const video = videoRef.current;
      bindVideo(stream, video);
      if (!video) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        bindVideo(stream, videoRef.current);
      }
      const el = videoRef.current;
      const got = el ? await waitForFrame(el, stream, 8000) : false;
      if (!got) {
        const fallback = await acquireCamera(true, "environment");
        streamRef.current = fallback;
        bindVideo(fallback, videoRef.current);
        const again = videoRef.current
          ? await waitForFrame(videoRef.current, fallback, 8000)
          : false;
        if (!again) {
          setCamera("error");
          return;
        }
      }
      setCamera("live");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[camera]", err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCamera("denied");
      } else {
        setCamera("error");
      }
    }
  }, []);

  useEffect(() => {
    holdCamera();
    void start(false);
    return () => {
      releaseCameraSoon();
    };
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    void getLlmConfig().then((llm) => {
      if (cancelled) return;
      const cfg = loadScanSettings();
      const nextRead = effectiveRead(cfg, llm);
      if (nextRead !== cfg.read) {
        saveScanSettings({ ...cfg, read: nextRead });
        settingsRef.current = { ...cfg, read: nextRead };
      }
      if (cfg.read === "local" && !llm.localAvailable) {
        setReaderWarn(null);
      } else if (
        (cfg.read === "byok" || cfg.read === "grok") &&
        !llm.byokAvailable
      ) {
        setReaderWarn("BYOK isn’t configured. Add an endpoint and API key in Settings.");
      } else if (mode === "receipt" && !llm.localAvailable && !llm.byokAvailable) {
        setReaderWarn(
          "Till tape still needs a vision model. Add a local server or a BYOK endpoint in Settings.",
        );
      } else {
        setReaderWarn(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (camera !== "live") return;
    const stream = streamRef.current ?? sharedStream;
    if (stream) bindVideo(stream, videoRef.current);
  }, [camera]);

  useEffect(() => {
    if (camera !== "live") return;
    const video = videoRef.current;
    const canvas = viewCanvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw < 2 || vh < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [camera]);

  useEffect(() => {
    if (camera !== "live") return;
    let cancelled = false;
    const cfg = loadScanSettings();
    settingsRef.current = cfg;
    async function boot() {
      const needPpocr = cfg.read === "ppocr";
      if (!needPpocr) {
        setEngine(null);
        return;
      }
      if (needPpocr && !ppocrReady()) {
        const ok = await loadPpocr((p) => {
          if (!cancelled) setEngine(p);
        });
        if (cancelled) return;
        if (!ok) {
          setEngine({ label: "PP-OCRv6 failed to load", pct: 0, error: true });
          toast.error("PP-OCRv6 did not load. Switch How to read to BYOK in Settings.");
        } else {
          setEngine({ label: "PP-OCRv6 ready", pct: 100 });
          window.setTimeout(() => {
            if (!cancelled) setEngine(null);
          }, 1200);
        }
      }
    }
    const t = window.setTimeout(() => {
      void boot();
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [camera]);

  const publishJobs = () => setJobs([...jobBag().jobs]);

  async function runJob(job: Job) {
    job.status = "reading";
    publishJobs();
    const cfg = loadScanSettings();
    settingsRef.current = cfg;
    try {
      if (job.mode === "label") {
        let data: LabelExtraction | null = null;
        const read = effectiveRead(cfg);
        if (read === "ppocr") {
          const ok = ppocrReady() || (await loadPpocr());
          if (!ok) throw new Error("PP-OCRv6 did not load");
          const img = await loadImage(job.image);
          const canvas = imageToCanvas(img, 1280);
          const hit = await runPpocr(canvas, undefined, { reticle: false, feel: cfg.ppocrFeel });
          data = parsePpocrText(hit.text, job.barcode);
          if (extractionIsThin(data) && !hit.text && !job.barcode) {
            throw new Error("PP-OCR found no product text");
          }
        } else if (read === "device") {
          const img = await loadImage(job.image);
          data = await readLabelOnDevice(img, job.barcode);
        } else {
          const result = await scanLabelPhoto({
            data: {
              imageDataUrl: job.image,
              barcodeHint: job.barcode,
              detail: cfg.visionDetail,
              provider: read === "byok" || read === "grok" ? "byok" : "local",
            },
          });
          if (!result.ok) throw new Error(result.error);
          data = result.data;
          if (job.barcode && !data.barcode) data.barcode = job.barcode;
        }
        if (!data) throw new Error("Nothing readable on this photo");
        const mem = await lookupProduct({
          data: { barcode: data.barcode ?? job.barcode, name: data.name },
        }).catch(() => null);
        if (mem) data = fillFromMemory(data, mem);
        if (job.itemId) {
          await updateItem({
            data: {
              itemId: job.itemId,
              patch: {
                name: data.name,
                brand: data.brand,
                description: data.description,
                barcode: data.barcode,
                category: data.category,
                quantity: data.quantity,
                quantityUnit: data.quantityUnit,
                weightValue: data.weightValue,
                weightUnit: data.weightUnit,
                unitPrice: data.unitPrice,
                linePrice: data.linePrice,
                matchStatus: "unmatched",
                matchConfidence: extractionConfidence(data),
                rawText: data.rawText,
              },
            },
          });
          if (job.shotId) {
            await updateScanShot({
              data: {
                shotId: job.shotId,
                lastRead: data,
                itemId: job.itemId,
                barcode: data.barcode,
              },
            }).catch(() => undefined);
          }
          job.confidence = extractionConfidence(data);
          toast.success(`Added ${data.name}`);
          onSaved();
        } else {
          job.confidence = extractionConfidence(data);
          setPending({ kind: "label", image: job.image, data, shotId: job.shotId });
        }
      } else {
        const result = await scanReceiptPhoto({
          data: {
            imageDataUrl: job.image,
            detail: cfg.visionDetail,
            provider: visionProvider(cfg),
          },
        });
        if (!result.ok) throw new Error(result.error);
        if (job.captureId) {
          await updateReceiptCapture({
            data: { captureId: job.captureId, extracted: result.data },
          });
          if (job.shotId) {
            await updateScanShot({
              data: { shotId: job.shotId, lastRead: result.data, captureId: job.captureId },
            }).catch(() => undefined);
          }
          toast.success("Receipt portion read");
          onSaved();
        } else {
          setPending({ kind: "receipt", image: job.image, data: result.data, shotId: job.shotId });
        }
      }
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : "Could not read that photo";
      toast.error(job.error);
      if (job.shotId) {
        await updateScanShot({
          data: {
            shotId: job.shotId,
            lastRead:
              job.mode === "label"
                ? { ...PLACEHOLDER_LABEL, name: "Couldn't read", rawText: job.error }
                : { ...emptyReceipt(), rawText: job.error },
          },
        }).catch(() => undefined);
      }
      if (job.itemId) {
        await updateItem({
          data: {
            itemId: job.itemId,
            patch: { name: "Couldn't read", matchStatus: "unmatched", matchConfidence: 0 },
          },
        }).catch(() => undefined);
        onSaved();
      }
    } finally {
      publishJobs();
      window.setTimeout(() => {
        const bag = jobBag();
        bag.jobs = bag.jobs.filter((j) => j.id !== job.id || (j.status !== "done" && j.status !== "error"));
        publishJobs();
      }, job.status === "error" ? 8000 : 2200);
    }
  }

  async function drain() {
    const bag = jobBag();
    const cfg = loadScanSettings();
    const maxParallel = cfg.read === "ppocr" || cfg.read === "device" ? 1 : 3;
    while (bag.running < maxParallel) {
      const next = bag.jobs.find((j) => j.status === "queued" && !bag.claimed.has(j.id));
      if (!next) return;
      bag.claimed.add(next.id);
      next.status = "reading";
      bag.running += 1;
      publishJobs();
      void runJob(next).finally(() => {
        bag.running = Math.max(0, bag.running - 1);
        bag.claimed.delete(next.id);
        void drain();
      });
    }
  }

  async function enqueue(image: string, barcode: string | null, scanMode: ScanMode) {
    const cfg = loadScanSettings();
    settingsRef.current = cfg;
    const dataUrl = image.startsWith("data:") ? image : await publicImageToDataUrl(image);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const job: Job = { id, mode: scanMode, image: dataUrl, barcode, status: "queued" };
    const thumb = await makeThumbnail(dataUrl);
    if (!holdForLook(cfg)) {
      if (scanMode === "label") {
        const item = await addLabelItem({
          data: {
            tripId,
            extracted: { ...PLACEHOLDER_LABEL, barcode },
            thumbnailData: thumb,
            matchStatus: "processing",
          },
        });
        job.itemId = item.id;
      } else {
        const cap = await addReceiptCapture({
          data: { tripId, extracted: emptyReceipt(), thumbnailData: thumb },
        });
        job.captureId = cap.id;
      }
      onSaved();
    }
    try {
      const shot = await addScanShot({
        data: {
          tripId,
          kind: scanMode,
          imageData: dataUrl,
          thumbnailData: thumb,
          barcode,
          itemId: job.itemId ?? null,
          captureId: job.captureId ?? null,
        },
      });
      job.shotId = shot.id;
    } catch (err) {
      console.error("[shot]", err);
    }
    jobBag().jobs = [...jobBag().jobs, job];
    publishJobs();
    void drain();
  }

  async function captureNow(fromBlob?: Blob) {
    if (snapLock.current) return;
    snapLock.current = true;
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    try {
      const video = videoRef.current;
      let image: string;
      if (fromBlob) {
        const preset = mode === "receipt" ? RECEIPT_CAPTURE : LABEL_CAPTURE;
        image = await blobToDataUrl(fromBlob, preset.maxSide, preset.quality);
      } else if (!video) {
        throw new Error("Camera is not ready");
      } else if (mode === "label") {
        image = cropVideo(video, LABEL_VIEWFINDER);
      } else {
        image = captureCanvas(video, RECEIPT_CAPTURE.maxSide, RECEIPT_CAPTURE.quality);
      }
      setHint(mode === "label" ? "Keep scanning" : "Next portion");
      snapLock.current = false;
      void (async () => {
        let barcode: string | null = null;
        if (mode === "label") {
          try {
            const blob = await (await fetch(image)).blob();
            const bmp = await createImageBitmap(blob);
            barcode = await detectBarcode(bmp);
            bmp.close();
          } catch {
            barcode = null;
          }
        }
        await enqueue(image, barcode, mode);
      })();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not capture");
      snapLock.current = false;
    } finally {
      snapLock.current = false;
    }
  }

  async function onFile(file: File) {
    await captureNow(file);
  }

  async function useSample(kind: ScanMode, id: string) {
    if (kind === "label") {
      const sample = SAMPLE_LABELS.find((s) => s.id === id);
      if (!sample) return;
      const image = await publicImageToDataUrl(sample.image);
      if (!holdForLook(settingsRef.current)) {
        const item = await addLabelItem({
          data: { tripId, extracted: sample.data, thumbnailData: sample.image },
        });
        await addScanShot({
          data: {
            tripId,
            kind: "label",
            imageData: image,
            thumbnailData: sample.image,
            itemId: item.id,
            lastRead: sample.data,
          },
        }).catch(() => undefined);
        toast.success(`Added ${sample.data.name}`);
        onSaved();
      } else {
        setPending({ kind: "label", image, data: sample.data });
      }
    } else {
      const sample = SAMPLE_RECEIPTS.find((s) => s.id === id);
      if (!sample) return;
      const image = await publicImageToDataUrl(sample.image);
      if (!holdForLook(settingsRef.current)) {
        const cap = await addReceiptCapture({
          data: { tripId, extracted: sample.data, thumbnailData: sample.image },
        });
        await addScanShot({
          data: {
            tripId,
            kind: "receipt",
            imageData: image,
            thumbnailData: sample.image,
            captureId: cap.id,
            lastRead: sample.data,
          },
        }).catch(() => undefined);
        toast.success("Receipt portion saved");
        onSaved();
      } else {
        setPending({ kind: "receipt", image, data: sample.data });
      }
    }
  }

  async function confirmPending() {
    if (!pending) return;
    setSaving(true);
    try {
      const thumb = pending.image.startsWith("data:")
        ? await makeThumbnail(pending.image)
        : pending.image;
      if (pending.kind === "label") {
        const item = await addLabelItem({
          data: { tripId, extracted: pending.data, thumbnailData: thumb },
        });
        if (pending.shotId) {
          await updateScanShot({
            data: { shotId: pending.shotId, itemId: item.id, lastRead: pending.data },
          }).catch(() => undefined);
        } else if (pending.image.startsWith("data:")) {
          await addScanShot({
            data: {
              tripId,
              kind: "label",
              imageData: pending.image,
              thumbnailData: thumb,
              itemId: item.id,
              lastRead: pending.data,
            },
          }).catch(() => undefined);
        }
        toast.success(`Added ${pending.data.name}`);
      } else {
        const cap = await addReceiptCapture({
          data: { tripId, extracted: pending.data, thumbnailData: thumb },
        });
        if (pending.shotId) {
          await updateScanShot({
            data: { shotId: pending.shotId, captureId: cap.id, lastRead: pending.data },
          }).catch(() => undefined);
        } else if (pending.image.startsWith("data:")) {
          await addScanShot({
            data: {
              tripId,
              kind: "receipt",
              imageData: pending.image,
              thumbnailData: thumb,
              captureId: cap.id,
              lastRead: pending.data,
            },
          }).catch(() => undefined);
        }
        toast.success("Receipt portion saved");
      }
      setPending(null);
      onSaved();
      setHint(mode === "label" ? "Frame the next label" : "Capture the next portion");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    const torchConstraint = { torch: next } as unknown as MediaTrackConstraints;
    void track.applyConstraints({ advanced: [torchConstraint] }).then(
      () => setTorch(next),
      () => toast.error("Flash is not available on this camera"),
    );
  }

  const samples = mode === "label" ? SAMPLE_LABELS : SAMPLE_RECEIPTS.filter((s) => s.id !== "full");
  const inflight = jobs.filter((j) => j.status === "queued" || j.status === "reading");

  return (
    <div className="relative -mx-4 flex h-[calc(100svh-4.25rem-5.75rem)] flex-col overflow-hidden bg-bg">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          style={{ transform: "translateZ(0)" }}
          playsInline
          muted
          autoPlay
          disablePictureInPicture
          onLoadedMetadata={(e) => {
            void e.currentTarget.play().catch(() => undefined);
          }}
          onPlaying={() => {
            if (videoRef.current && videoRef.current.videoWidth > 2) setCamera("live");
          }}
          onClick={() => {
            void videoRef.current?.play().catch(() => undefined);
          }}
        />
        <canvas
          ref={viewCanvasRef}
          className="pointer-events-none absolute inset-0 size-full"
          style={{ transform: "translateZ(0)" }}
        />
        {camera !== "live" && (
          <div
            className={cn(
              "absolute inset-0 z-10 grid place-items-center px-6 text-center",
              camera === "starting" ? "bg-bg/40" : "bg-bg",
            )}
          >
            <div>
              {camera === "starting" ? (
                <LoaderCircle className="mx-auto size-8 animate-spin text-muted" />
              ) : (
                <CameraOff className="mx-auto size-8 text-muted" />
              )}
              <p className="mt-3 font-display text-2xl">
                {camera === "starting"
                  ? "Starting camera…"
                  : camera === "denied"
                    ? "Camera is blocked"
                    : "Tap to start the camera"}
              </p>
              <p className="mt-2 text-sm text-muted">
                {camera === "denied"
                  ? "Allow camera for this site, then tap Enable."
                  : "If the picture stays black, tap Enable, then Photo to use the phone camera app."}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const v = videoRef.current;
                    if (v) void v.play().catch(() => undefined);
                    void start(true);
                  }}
                >
                  <SwitchCamera className="size-4" />
                  Enable camera
                </Button>
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" />
                  Photo
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-[2]">
          <div
            className={cn(
              "absolute left-[4%] right-[4%] rounded-[28px] border-2",
              mode === "receipt" ? "top-[6%] bottom-[8%]" : "top-[8%] bottom-[12%]",
              "border-fg/35",
            )}
          />
        </div>

        {flash && <div className="shutter-flash pointer-events-none absolute inset-0 bg-fg" />}

        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 p-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))]">
          <Button type="button" variant="secondary" size="icon" onClick={onClose} aria-label="Close scanner">
            <X className="size-5" />
          </Button>
          <p className="rounded-full bg-bg/70 px-3 py-1.5 text-xs font-medium text-fg backdrop-blur-sm">
            {inflight.length > 0
              ? `${inflight.length} reading in background`
              : engine && engine.pct < 100
                ? engine.label
                : hint}
          </p>
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="icon">
              <Link to="/settings" aria-label="Settings">
                <SlidersHorizontal className="size-5" />
              </Link>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={toggleTorch}
              disabled={camera !== "live"}
              aria-label="Toggle flash"
            >
              {torch ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
            </Button>
          </div>
        </div>

        {engine && engine.pct < 100 && (
          <div className="absolute inset-x-12 top-20">
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated/80">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${engine.pct}%` }}
              />
            </div>
          </div>
        )}

        {readerWarn && (
          <p
            className={cn(
              "absolute inset-x-4 z-20 rounded-xl bg-surface/95 px-3 py-2 text-center text-xs leading-5 text-fg shadow-[var(--shadow-border)]",
              engine && engine.pct < 100 ? "top-24" : "top-[4.75rem]",
            )}
          >
            {readerWarn}{" "}
            <Link to="/settings" className="font-medium underline underline-offset-2">
              Open settings
            </Link>
          </p>
        )}

        {jobs.length > 0 && (
          <ul className="absolute inset-x-0 bottom-3 flex justify-center gap-2 px-4">
            {jobs.slice(-6).map((j) => (
              <li
                key={j.id}
                className="relative size-12 overflow-hidden rounded-md bg-elevated shadow-[var(--shadow-border)]"
              >
                <img src={j.image} alt="" className="size-full object-cover opacity-80" />
                {j.status !== "done" && j.status !== "error" && (
                  <span className="absolute inset-0 grid place-items-center bg-bg/40">
                    <LoaderCircle className="size-4 animate-spin text-fg" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-bg/75 px-0.5 py-0.5 text-center text-[8px] font-medium uppercase leading-tight text-fg">
                  {j.status === "queued"
                    ? "Pending"
                    : j.status === "reading"
                      ? "Reading"
                      : j.status === "error"
                        ? "Failed"
                        : j.itemId || j.captureId
                          ? j.confidence != null
                            ? `Cart ${Math.round(j.confidence * 100)}%`
                            : "In cart"
                          : "Read"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-bg px-4 pb-3 pt-3">
        <div className="mb-3 grid grid-cols-2 rounded-xl bg-elevated p-1">
          {(["label", "receipt"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onMode(m);
                setHint(m === "label" ? "Frame a label" : "Align the till tape");
              }}
              className={cn(
                "h-10 rounded-lg text-sm font-medium",
                mode === m ? "bg-fg text-bg" : "text-muted",
              )}
            >
              {m === "label" ? "Labels" : "Receipt"}
            </button>
          ))}
        </div>

        <p className="mb-3 text-xs text-muted">
          Reader: {READ_OPTIONS.find((o) => o.id === scanCfg.read)?.title}.{" "}
          {scanCfg.read === "local" || scanCfg.read === "byok" || scanCfg.read === "grok"
            ? "Snaps go to the cart and read in the background — no confirm sheet."
            : holdForLook(scanCfg)
              ? "Hold for a look is on — confirm before it joins the cart."
              : "Add to cart, fill in later — reading continues in the background, including PP-OCR."}
        </p>

        <div className="flex items-center justify-between gap-3">
          <label className="grid size-12 place-items-center rounded-lg bg-elevated">
            <ImagePlus className="size-5" />
            <span className="sr-only">Upload photo</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void captureNow()}
            disabled={camera !== "live"}
            className="grid size-20 place-items-center rounded-full bg-fg text-bg disabled:opacity-40"
            aria-label="Shutter"
          >
            <ScanLine className="size-7" />
          </button>
          <div className="size-12" />
        </div>

        {scanCfg.debugSamples && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-subtle">
            Try a sample
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void useSample(mode, s.id)}
                className="w-28 shrink-0 text-left"
              >
                <img
                  src={s.image}
                  alt=""
                  className="h-20 w-28 rounded-md object-cover"
                />
                <span className="mt-1 block truncate text-xs text-muted">{s.title}</span>
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      {pending && (
        <ConfirmSheet
          pending={pending}
          saving={saving}
          onCancel={() => setPending(null)}
          onChange={setPending}
          onConfirm={() => void confirmPending()}
        />
      )}
    </div>
  );
}

function ConfirmSheet({
  pending,
  saving,
  onCancel,
  onChange,
  onConfirm,
}: {
  pending: Pending;
  saving: boolean;
  onCancel: () => void;
  onChange: (next: Pending) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-bg/55 backdrop-blur-[2px]">
      <div className="max-h-[78%] overflow-y-auto rounded-t-2xl bg-surface px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-border)]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-elevated" />
        <div className="flex gap-3">
          <img
            src={pending.image}
            alt=""
            className="size-20 rounded-md object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.16em] text-subtle">
              {pending.kind === "label" ? "Label read" : "Receipt portion"}
            </p>
            <h2 className="font-display text-2xl leading-tight">
              {pending.kind === "label"
                ? pending.data.name
                : pending.data.storeName ?? "Till tape"}
            </h2>
            <p className="text-sm text-muted">
              {pending.kind === "label"
                ? pending.data.description ?? pending.data.brand ?? "Check the fields, then add to the cart"
                : `${pending.data.items.length} line${pending.data.items.length === 1 ? "" : "s"} · ${pending.data.portionHint ?? "portion"}`}
            </p>
          </div>
        </div>

        {pending.kind === "label" ? (
          <div className="mt-4 grid gap-3">
            <Field
              label="Name"
              value={pending.data.name}
              onChange={(v) =>
                onChange({ ...pending, data: { ...pending.data, name: v } })
              }
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Weight"
                value={pending.data.weightValue?.toString() ?? ""}
                onChange={(v) =>
                  onChange({
                    ...pending,
                    data: { ...pending.data, weightValue: v ? Number(v) : null },
                  })
                }
              />
              <Field
                label="Unit"
                value={pending.data.weightUnit ?? ""}
                onChange={(v) =>
                  onChange({ ...pending, data: { ...pending.data, weightUnit: v || null } })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Price"
                value={pending.data.linePrice?.toString() ?? ""}
                onChange={(v) =>
                  onChange({
                    ...pending,
                    data: { ...pending.data, linePrice: v ? Number(v) : null },
                  })
                }
              />
              <p className="self-end text-sm text-muted">
                {money(pending.data.linePrice, pending.data.currency ?? "AED")} ·{" "}
                {qty(pending.data.quantity, pending.data.quantityUnit)} ·{" "}
                {weight(pending.data.weightValue, pending.data.weightUnit)}
              </p>
            </div>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border text-sm">
            {pending.data.items.map((line, i) => (
              <li key={`${line.name}-${i}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{line.name}</span>
                <span className="tabular-nums text-muted">
                  {money(line.linePrice, pending.data.currency ?? "AED")}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Discard
          </Button>
          <Button type="button" onClick={onConfirm} disabled={saving}>
            {saving ? "Saving…" : pending.kind === "label" ? "Add to cart" : "Keep portion"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
