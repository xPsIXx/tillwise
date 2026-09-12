import { toast } from "sonner";
import { extractionConfidence } from "./parse-local";
import { tripDay, money, unitMoney } from "./format";
import { readLabelCapture, readReceiptCapture } from "./read-capture";
import { getShotImage, lastPaid, updateItem, updateReceiptCapture, updateScanShot } from "./server";
import { loadScanSettings } from "./settings";
import type { LabelExtraction, ReceiptExtraction, ScanMode, ScanShot } from "./types";

export type ScanJob = {
  id: string;
  mode: ScanMode;
  image: string;
  barcode: string | null;
  status: "queued" | "reading" | "done" | "error";
  tripId?: number;
  storeName?: string | null;
  itemId?: number;
  captureId?: number;
  shotId?: number;
  error?: string;
  confidence?: number | null;
};

type Bag = {
  jobs: ScanJob[];
  running: number;
  claimed: Set<string>;
};

function bag(): Bag {
  const g = globalThis as typeof globalThis & { __tillwiseScanJobs?: Bag };
  if (!g.__tillwiseScanJobs) {
    g.__tillwiseScanJobs = { jobs: [], running: 0, claimed: new Set() };
  }
  return g.__tillwiseScanJobs;
}

const listeners = new Set<() => void>();
const savedListeners = new Set<() => void>();
let confirmHandler:
  | ((job: ScanJob, data: LabelExtraction | ReceiptExtraction) => void)
  | null = null;

export function setScanConfirmHandler(
  fn: ((job: ScanJob, data: LabelExtraction | ReceiptExtraction) => void) | null,
) {
  confirmHandler = fn;
}

export function listScanJobs(): ScanJob[] {
  return [...bag().jobs];
}

export function subscribeScanQueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onScanQueueSaved(fn: () => void): () => void {
  savedListeners.add(fn);
  return () => {
    savedListeners.delete(fn);
  };
}

function publish() {
  for (const fn of listeners) fn();
}

function notifySaved() {
  for (const fn of savedListeners) fn();
}

const PLACEHOLDER: LabelExtraction = {
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

export function shotFailed(shot: ScanShot): boolean {
  if (!shot.lastRead) return false;
  if (shot.kind === "label") {
    const name = "name" in shot.lastRead ? shot.lastRead.name : "";
    return name === "Couldn't read";
  }
  const rec = shot.lastRead as ReceiptExtraction;
  return Boolean(rec.rawText) && (rec.items?.length ?? 0) === 0 && rec.total == null;
}

export function shotNeedsRead(shot: ScanShot): boolean {
  if (shotFailed(shot)) return false;
  if (!shot.lastRead) return true;
  if (shot.kind === "label") {
    const name = "name" in shot.lastRead ? shot.lastRead.name : "";
    return !name || name === "Reading label…";
  }
  const rec = shot.lastRead as ReceiptExtraction;
  return (rec.items?.length ?? 0) === 0 && rec.total == null && !rec.storeName;
}

export function enqueueScanJob(job: Omit<ScanJob, "id" | "status"> & { id?: string; status?: ScanJob["status"] }) {
  const next: ScanJob = {
    ...job,
    id: job.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: job.status ?? "queued",
  };
  const jobs = bag().jobs;
  if (next.shotId && jobs.some((j) => j.shotId === next.shotId && j.status !== "done" && j.status !== "error")) {
    return next;
  }
  bag().jobs = [...jobs, next];
  publish();
  void drainScanQueue();
  return next;
}

async function runJob(job: ScanJob) {
  job.status = "reading";
  publish();
  try {
    if (job.mode === "label") {
      const data = await readLabelCapture(job.image, job.barcode, undefined, {
        storeName: job.storeName,
      });
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
        try {
          const paid = await lastPaid({
            data: { barcode: data.barcode, name: data.name, excludeTripId: job.tripId ?? null },
          });
          if (paid && (paid.unitPrice != null || paid.linePrice != null)) {
            const price =
              paid.unitPrice != null
                ? unitMoney(paid.unitPrice, paid.currency, paid.weightUnit)
                : money(paid.linePrice, paid.currency);
            toast.message(
              `Last at ${paid.storeName || "a store"}: ${price} (${tripDay(paid.observedAt)})`,
            );
          }
        } catch {
          /* catalog is optional */
        }
        notifySaved();
      } else if (confirmHandler) {
        job.confidence = extractionConfidence(data);
        confirmHandler(job, data);
      }
    } else {
      const data = await readReceiptCapture(job.image, undefined, job.storeName);
      if (job.captureId) {
        await updateReceiptCapture({
          data: { captureId: job.captureId, extracted: data },
        });
        if (job.shotId) {
          await updateScanShot({
            data: { shotId: job.shotId, lastRead: data, captureId: job.captureId },
          }).catch(() => undefined);
        }
        toast.success("Receipt portion read");
        notifySaved();
      } else if (confirmHandler) {
        confirmHandler(job, data);
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
              ? { ...PLACEHOLDER, name: "Couldn't read", rawText: job.error }
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
      notifySaved();
    }
  } finally {
    publish();
    window.setTimeout(() => {
      bag().jobs = bag().jobs.filter((j) => j.id !== job.id || (j.status !== "done" && j.status !== "error"));
      publish();
    }, job.status === "error" ? 8000 : 2200);
  }
}

export async function drainScanQueue() {
  const b = bag();
  const cfg = loadScanSettings();
  const maxParallel = cfg.read === "ppocr" || cfg.read === "device" ? 1 : 3;
  while (b.running < maxParallel) {
    const next = b.jobs.find((j) => j.status === "queued" && !b.claimed.has(j.id));
    if (!next) return;
    b.claimed.add(next.id);
    next.status = "reading";
    b.running += 1;
    publish();
    void runJob(next).finally(() => {
      b.running = Math.max(0, b.running - 1);
      b.claimed.delete(next.id);
      void drainScanQueue();
    });
  }
}

export async function resumeShots(shots: ScanShot[]): Promise<number> {
  let n = 0;
  for (const shot of shots) {
    try {
      if (shot.itemId) {
        await updateItem({
          data: {
            itemId: shot.itemId,
            patch: { name: "Reading label…", matchStatus: "processing" },
          },
        }).catch(() => undefined);
      }
      const { image } = await getShotImage({ data: shot.id });
      enqueueScanJob({
        mode: shot.kind,
        image,
        barcode: shot.barcode,
        tripId: shot.tripId,
        storeName: shot.storeName,
        itemId: shot.itemId ?? undefined,
        captureId: shot.captureId ?? undefined,
        shotId: shot.id,
      });
      n += 1;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open photo");
    }
  }
  return n;
}

export async function resumeUnreadShots(shots: ScanShot[]): Promise<number> {
  return resumeShots(shots.filter(shotNeedsRead));
}
