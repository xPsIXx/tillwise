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
import { detectBarcode, scoreFrame, StabilityGate } from "@/lib/grocery/detect";
import {
  blobToDataUrl,
  captureCanvas,
  cropVideo,
  imageToCanvas,
  loadImage,
  makeThumbnail,
  publicImageToDataUrl,
  type CropBox,
} from "@/lib/grocery/image";
import { extractionIsThin, readLabelOnDevice } from "@/lib/grocery/parse-local";
import { loadPpocr, parsePpocrText, ppocrReady, runPpocr } from "@/lib/grocery/ppocr";
import { SAMPLE_LABELS, SAMPLE_RECEIPTS } from "@/lib/grocery/sample-data";
import { loadScanSettings, visionProvider, type ScanSettings } from "@/lib/grocery/settings";
import { loadTfjs, scoreTfFrame, tfReady, type EngineProgress } from "@/lib/grocery/tfjs";
import {
  addLabelItem,
  addReceiptCapture,
  scanLabelPhoto,
  scanReceiptPhoto,
  updateItem,
  updateReceiptCapture,
} from "@/lib/grocery/server";
import type { LabelExtraction, ReceiptExtraction, ScanMode } from "@/lib/grocery/types";
import { money, qty, weight } from "@/lib/grocery/format";
import { cn } from "@/lib/utils";

type Pending =
  | { kind: "label"; image: string; data: LabelExtraction; itemId?: number }
  | { kind: "receipt"; image: string; data: ReceiptExtraction; captureId?: number };

type Job = {
  id: string;
  mode: ScanMode;
  image: string;
  barcode: string | null;
  status: "queued" | "reading" | "done" | "error";
  itemId?: number;
  captureId?: number;
  error?: string;
};

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
let gumAbort: AbortController | null = null;

function streamIsLive(stream: MediaStream | null): stream is MediaStream {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));
}

function bindVideo(stream: MediaStream, video: HTMLVideoElement | null) {
  if (!video) return false;
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  if (video.srcObject !== stream) video.srcObject = stream;
  void video.play().catch(() => undefined);
  return true;
}

async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera API missing", "NotSupportedError");
  }
  gumAbort?.abort();
  const ac = new AbortController();
  gumAbort = ac;
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    if (ac.signal.aborted) break;
    try {
      return await navigator.mediaDevices.getUserMedia({
        ...constraints,
        signal: ac.signal,
      } as MediaStreamConstraints);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Camera failed");
}

function acquireCamera(fresh = false): Promise<MediaStream> {
  if (!fresh && streamIsLive(sharedStream)) return Promise.resolve(sharedStream);
  if (!fresh && sharedAcquire) return sharedAcquire;
  if (fresh) {
    gumAbort?.abort();
    sharedAcquire = null;
  }
  const raw = openCamera().then((stream) => {
    sharedStream = stream;
    return stream;
  });
  sharedAcquire = raw.finally(() => {
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
  const streamRef = useRef<MediaStream | null>(null);
  const gateRef = useRef(new StabilityGate(4, 900));
  const snapLock = useRef(false);
  const jobsRef = useRef<Job[]>([]);
  const runningRef = useRef(0);
  const settingsRef = useRef<ScanSettings>(loadScanSettings());
  const lastCropRef = useRef<CropBox | null>(null);
  const [camera, setCamera] = useState<CameraStatus>("starting");
  const [torch, setTorch] = useState(false);
  const [hint, setHint] = useState("Frame a label");
  const [locked, setLocked] = useState(false);
  const [flash, setFlash] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saving, setSaving] = useState(false);
  const [engine, setEngine] = useState<EngineProgress | null>(null);

  const start = useCallback(async (fresh = false) => {
    setCamera((c) => (c === "live" && !fresh ? c : "starting"));
    const uiTimer = window.setTimeout(() => {
      setCamera((c) => (c === "starting" ? "error" : c));
    }, 8000);
    try {
      const stream = await acquireCamera(fresh);
      streamRef.current = stream;
      if (!bindVideo(stream, videoRef.current)) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        bindVideo(stream, videoRef.current);
      }
      setCamera("live");
      gateRef.current.reset();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("[camera]", err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCamera("denied");
      } else {
        setCamera("error");
      }
    } finally {
      window.clearTimeout(uiTimer);
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
    if (camera !== "live") return;
    const stream = streamRef.current ?? sharedStream;
    if (stream) bindVideo(stream, videoRef.current);
  }, [camera]);

  useEffect(() => {
    if (camera !== "live") return;
    let cancelled = false;
    const cfg = loadScanSettings();
    settingsRef.current = cfg;
    async function boot() {
      const needTf = cfg.detect === "tensorflow";
      const needPpocr = cfg.detect === "ppocr" || cfg.read === "ppocr";
      if (!needTf && !needPpocr) {
        setEngine(null);
        return;
      }
      if (needTf && !tfReady()) {
        const ok = await loadTfjs((p) => {
          if (!cancelled) setEngine(p);
        });
        if (cancelled) return;
        if (!ok) {
          setEngine({ label: "TensorFlow.js failed to load — using shape detect", pct: 0 });
          toast.error("TensorFlow.js did not load. Shape detect is still available.");
        } else {
          setEngine({ label: "TensorFlow.js ready", pct: 100 });
          window.setTimeout(() => {
            if (!cancelled) setEngine(null);
          }, 1200);
        }
      }
      if (needPpocr && !ppocrReady()) {
        const ok = await loadPpocr((p) => {
          if (!cancelled) setEngine(p);
        });
        if (cancelled) return;
        if (!ok) {
          setEngine({ label: "PP-OCRv6 failed to load", pct: 0, error: true });
          toast.error("PP-OCRv6 did not load. Try shape detect or another reader.");
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

  const publishJobs = () => setJobs([...jobsRef.current]);

  async function runJob(job: Job) {
    job.status = "reading";
    publishJobs();
    const cfg = loadScanSettings();
    settingsRef.current = cfg;
    try {
      if (job.mode === "label") {
        let data: LabelExtraction | null = null;
        if (cfg.read === "ppocr") {
          const ok = ppocrReady() || (await loadPpocr());
          if (!ok) throw new Error("PP-OCRv6 did not load");
          const img = await loadImage(job.image);
          const canvas = imageToCanvas(img, 960);
          const hit = await runPpocr(canvas, 0.15, { reticle: false });
          data = parsePpocrText(hit.text, job.barcode);
          if (extractionIsThin(data) && !hit.text && !job.barcode) {
            throw new Error("PP-OCR found no product text");
          }
        } else if (cfg.read === "device") {
          const img = await loadImage(job.image);
          data = await readLabelOnDevice(img, job.barcode);
        } else {
          const result = await scanLabelPhoto({
            data: {
              imageDataUrl: job.image,
              barcodeHint: job.barcode,
              detail: cfg.visionDetail,
              provider: cfg.read === "grok" ? "grok" : "local",
            },
          });
          if (!result.ok) throw new Error(result.error);
          data = result.data;
          if (job.barcode && !data.barcode) data.barcode = job.barcode;
        }
        if (!data) throw new Error("Nothing readable on this photo");
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
                rawText: data.rawText,
              },
            },
          });
          toast.success(`Added ${data.name}`);
          onSaved();
        } else {
          setPending({ kind: "label", image: job.image, data });
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
          toast.success("Receipt portion read");
          onSaved();
        } else {
          setPending({ kind: "receipt", image: job.image, data: result.data });
        }
      }
      job.status = "done";
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : "Could not read that photo";
      toast.error(job.error);
      if (job.itemId) {
        await updateItem({
          data: {
            itemId: job.itemId,
            patch: { name: "Couldn't read", matchStatus: "unmatched" },
          },
        }).catch(() => undefined);
        onSaved();
      }
    } finally {
      publishJobs();
      window.setTimeout(() => {
        jobsRef.current = jobsRef.current.filter((j) => j.id !== job.id || j.status === "reading");
        publishJobs();
      }, 1800);
    }
  }

  async function drain() {
    while (runningRef.current < 2) {
      const next = jobsRef.current.find((j) => j.status === "queued");
      if (!next) return;
      next.status = "reading";
      runningRef.current += 1;
      publishJobs();
      void runJob(next).finally(() => {
        runningRef.current -= 1;
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
    if (cfg.autoAdd) {
      const thumb = await makeThumbnail(dataUrl);
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
    jobsRef.current = [...jobsRef.current, job];
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
      const crop = lastCropRef.current;
      const cfg = settingsRef.current;
      let image: string;
      if (fromBlob) {
        image = await blobToDataUrl(fromBlob);
      } else if (video && crop && cfg.detect === "ppocr" && mode === "label") {
        image = cropVideo(video, crop);
      } else {
        image = captureCanvas(video!);
      }
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
      setHint(mode === "label" ? "Keep scanning" : "Next portion");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not capture");
    } finally {
      snapLock.current = false;
      gateRef.current.reset();
    }
  }

  useEffect(() => {
    if (camera !== "live") return;
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let ticks = 0;
    let inflight = false;
    let lastPpocr = 0;
    let lastTf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const loop = () => {
      raf = requestAnimationFrame(loop);
      ticks += 1;
      if (ticks % 4 !== 0 || !ctx || snapLock.current || inflight) return;
      if (video.readyState < 2) return;
      const cfg = loadScanSettings();
      settingsRef.current = cfg;
      const detect = cfg.detect;
      if (detect === "off") {
        setLocked(false);
        lastCropRef.current = null;
        return;
      }
      const w = detect === "ppocr" ? 480 : 320;
      const h = Math.round((video.videoHeight / Math.max(video.videoWidth, 1)) * w) || 180;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);

      inflight = true;
      void (async () => {
        try {
          let ready = false;
          let code: string | null = null;
          if (detect === "tensorflow") {
            const now = Date.now();
            if (now - lastTf < 400) return;
            lastTf = now;
            if (tfReady()) {
              const score = await scoreTfFrame(canvas);
              ready = score >= cfg.confidence;
              setHint(ready ? "Label locked" : `MobileNet ${Math.round(score * 100)}%`);
            } else {
              const frame = ctx.getImageData(0, 0, w, h);
              const scored = scoreFrame(frame, mode);
              ready = scored.focused && scored.aligned && scored.score > cfg.confidence;
              setHint("Loading TensorFlow.js…");
            }
            lastCropRef.current = null;
          } else if (detect === "ppocr") {
            const now = Date.now();
            if (now - lastPpocr < 900) return;
            lastPpocr = now;
            if (ppocrReady()) {
              const hit = await runPpocr(canvas, cfg.confidence, { reticle: true });
              lastCropRef.current = hit.crop;
              ready = hit.ready;
              if (hit.text) setHint(hit.text.slice(0, 32));
              else if (ready) setHint("Label locked");
              else setHint("Frame the sticker");
            } else {
              const frame = ctx.getImageData(0, 0, w, h);
              const scored = scoreFrame(frame, mode);
              ready = scored.focused && scored.aligned && scored.score > cfg.confidence;
              setHint("Loading PP-OCRv6…");
            }
          } else {
            lastCropRef.current = null;
            const frame = ctx.getImageData(0, 0, w, h);
            const scored = scoreFrame(frame, mode);
            code = await detectBarcode(canvas);
            ready =
              detect === "barcode"
                ? Boolean(code)
                : Boolean(code) ||
                  (scored.focused && scored.aligned && scored.score > cfg.confidence);
            if (code) setHint(`Barcode ${code}`);
            else if (ready) setHint(mode === "receipt" ? "Receipt locked" : "Label locked");
            else if (scored.focused) setHint("Hold steady");
            else setHint(mode === "receipt" ? "Align the till tape" : "Frame the sticker");
          }
          setLocked(ready);
          if (cfg.autoCapture && gateRef.current.update(ready)) {
            void captureNow();
          }
        } finally {
          inflight = false;
        }
      })();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, mode]);

  async function onFile(file: File) {
    lastCropRef.current = null;
    await captureNow(file);
  }

  async function useSample(kind: ScanMode, id: string) {
    if (kind === "label") {
      const sample = SAMPLE_LABELS.find((s) => s.id === id);
      if (!sample) return;
      if (settingsRef.current.autoAdd) {
        await addLabelItem({
          data: { tripId, extracted: sample.data, thumbnailData: sample.image },
        });
        toast.success(`Added ${sample.data.name}`);
        onSaved();
      } else {
        setPending({ kind: "label", image: sample.image, data: sample.data });
      }
    } else {
      const sample = SAMPLE_RECEIPTS.find((s) => s.id === id);
      if (!sample) return;
      if (settingsRef.current.autoAdd) {
        await addReceiptCapture({
          data: { tripId, extracted: sample.data, thumbnailData: sample.image },
        });
        toast.success("Receipt portion saved");
        onSaved();
      } else {
        setPending({ kind: "receipt", image: sample.image, data: sample.data });
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
        await addLabelItem({
          data: { tripId, extracted: pending.data, thumbnailData: thumb },
        });
        toast.success(`Added ${pending.data.name}`);
      } else {
        await addReceiptCapture({
          data: { tripId, extracted: pending.data, thumbnailData: thumb },
        });
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
    <div className="relative -mx-4 flex min-h-[calc(100dvh-5rem)] flex-col bg-bg">
      <div className="relative flex-1 overflow-hidden bg-bg">
        <video
          ref={videoRef}
          className="absolute inset-0 size-full object-cover"
          playsInline
          muted
          autoPlay
          disablePictureInPicture
          onLoadedMetadata={(e) => {
            void e.currentTarget.play().catch(() => undefined);
          }}
          onPlaying={() => {
            if (streamIsLive(streamRef.current ?? sharedStream)) setCamera("live");
          }}
        />
        {camera !== "live" && (
          <div
            className={cn(
              "absolute inset-0 grid place-items-center px-6 text-center",
              camera === "starting" ? "bg-bg/55" : "bg-bg",
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
                {camera === "starting"
                  ? "Allow access when the phone asks. The live view should appear before PP-OCR finishes loading."
                  : camera === "denied"
                    ? "Allow camera for this site in the browser address bar, then tap Enable."
                    : "The live view starts from a tap so the phone will actually show the feed."}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-5"
                onClick={() => void start(true)}
              >
                <SwitchCamera className="size-4" />
                Enable camera
              </Button>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0">
          <div
            className={cn(
              "absolute left-[12%] right-[12%] rounded-[28px] border-2",
              mode === "receipt" ? "top-[10%] bottom-[18%]" : "top-[18%] bottom-[28%]",
              locked ? "border-accent viewfinder-pulse" : "border-fg/35",
            )}
          />
        </div>

        {flash && <div className="shutter-flash pointer-events-none absolute inset-0 bg-fg" />}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 pr-16 pt-[max(1rem,env(safe-area-inset-top))]">
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border bg-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mb-3 grid grid-cols-2 rounded-xl bg-elevated p-1">
          {(["label", "receipt"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onMode(m);
                gateRef.current.reset();
                lastCropRef.current = null;
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

        <div className="flex items-center justify-between gap-3">
          <label className="grid size-12 place-items-center rounded-lg bg-elevated">
            <ImagePlus className="size-5" />
            <span className="sr-only">Upload photo</span>
            <input
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
