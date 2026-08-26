import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  blobToDataUrl,
  LABEL_CAPTURE,
  makeThumbnail,
  RECEIPT_CAPTURE,
} from "@/lib/grocery/image";
import { readLabelCapture, readReceiptCapture } from "@/lib/grocery/read-capture";
import {
  addLabelItem,
  addReceiptCapture,
  deleteScanShot,
  getShotImage,
  updateItem,
  updateReceiptCapture,
  updateScanShot,
} from "@/lib/grocery/server";
import { loadScanSettings, READ_OPTIONS, type ReadMode } from "@/lib/grocery/settings";
import type { LabelExtraction, ReceiptExtraction, ScanShot } from "@/lib/grocery/types";
import { money, tripDate, unitMoney, weight } from "@/lib/grocery/format";
import { tagForShot, tagTone } from "@/lib/grocery/shot-status";
import { cn } from "@/lib/utils";

export function ShotSheet({
  shot,
  onClose,
  onChanged,
}: {
  shot: ScanShot;
  onClose: () => void;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(shot.thumbnailData);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [read, setRead] = useState<ReadMode>(() => {
    const cur = loadScanSettings().read;
    if (shot.kind === "receipt") return cur === "byok" || cur === "grok" ? "byok" : "local";
    return cur;
  });
  const last = shot.lastRead;

  useEffect(() => {
    let cancelled = false;
    void getShotImage({ data: shot.id })
      .then((res) => {
        if (!cancelled) setImage(res.image);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load the original photo");
      });
    return () => {
      cancelled = true;
    };
  }, [shot.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function reprocess() {
    if (!image) return;
    setBusy("read");
    try {
      if (shot.kind === "label") {
        const data = await readLabelCapture(image, shot.barcode, read);
        await applyLabel(data);
        toast.success(`Read ${data.name}`);
      } else {
        const data = await readReceiptCapture(image, read === "byok" || read === "grok" ? "byok" : "local");
        await applyReceipt(data);
        toast.success("Receipt re-read");
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reprocess");
    } finally {
      setBusy(null);
    }
  }

  async function applyLabel(data: LabelExtraction) {
    if (shot.itemId) {
      await updateItem({
        data: {
          itemId: shot.itemId,
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
      await updateScanShot({ data: { shotId: shot.id, lastRead: data, barcode: data.barcode } });
      return;
    }
    const item = await addLabelItem({
      data: { tripId: shot.tripId, extracted: data, thumbnailData: shot.thumbnailData },
    });
    await updateScanShot({
      data: { shotId: shot.id, itemId: item.id, lastRead: data, barcode: data.barcode },
    });
  }

  async function applyReceipt(data: ReceiptExtraction) {
    if (shot.captureId) {
      await updateReceiptCapture({ data: { captureId: shot.captureId, extracted: data } });
      await updateScanShot({ data: { shotId: shot.id, lastRead: data } });
      return;
    }
    const cap = await addReceiptCapture({
      data: { tripId: shot.tripId, extracted: data, thumbnailData: shot.thumbnailData },
    });
    await updateScanShot({ data: { shotId: shot.id, captureId: cap.id, lastRead: data } });
  }

  async function replacePhoto(file: File) {
    setBusy("save");
    try {
      const preset = shot.kind === "receipt" ? RECEIPT_CAPTURE : LABEL_CAPTURE;
      const next = await blobToDataUrl(file, preset.maxSide, preset.quality);
      const thumb = await makeThumbnail(next);
      await updateScanShot({
        data: { shotId: shot.id, imageData: next, thumbnailData: thumb },
      });
      setImage(next);
      toast.success("Photo replaced — re-reading");
      setBusy("read");
      if (shot.kind === "label") {
        const data = await readLabelCapture(next, shot.barcode, read);
        await applyLabel(data);
      } else {
        const data = await readReceiptCapture(next, read === "byok" || read === "grok" ? "byok" : "local");
        await applyReceipt(data);
      }
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not replace photo");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("save");
    try {
      await deleteScanShot({ data: shot.id });
      toast.success("Photo removed from history");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
      setBusy(null);
    }
  }

  const label = last && "name" in last ? last : null;
  const receipt = last && "items" in last ? last : null;
  const engines = shot.kind === "receipt" ? READ_OPTIONS.filter((o) => o.id === "local" || o.id === "byok") : READ_OPTIONS;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-bg/55 p-0 sm:place-items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[var(--shadow-border)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
              {shot.kind === "label" ? "Label shot" : "Receipt shot"} · {tripDate(shot.createdAt)}
            </p>
            <h3 className="font-display text-2xl">
              {label?.name ?? receipt?.storeName ?? (shot.kind === "label" ? "Label" : "Till tape")}
            </h3>
            {(() => {
              const tag = tagForShot(shot);
              return (
                <p className="mt-1">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      tagTone(tag.state),
                    )}
                  >
                    {tag.label}
                    {tag.confidence != null ? ` · ${Math.round(tag.confidence * 100)}%` : ""}
                  </span>
                </p>
              );
            })()}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          <div className="relative overflow-hidden rounded-xl bg-elevated">
            {image ? (
              <img src={image} alt="" className="max-h-72 w-full object-contain" />
            ) : (
              <div className="grid h-48 place-items-center text-sm text-muted">No photo</div>
            )}
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-bg/40">
                <LoaderCircle className="size-6 animate-spin text-fg" />
              </div>
            )}
          </div>

          {label && (
            <div className="mt-3 space-y-1 text-sm text-muted">
              <p>
                {weight(label.weightValue, label.weightUnit)}
                {" · "}
                {unitMoney(label.unitPrice, label.currency ?? "AED", label.weightUnit)}
                {" · "}
                {money(label.linePrice, label.currency ?? "AED")}
              </p>
              {label.barcode ? <p className="font-mono text-xs">{label.barcode}</p> : null}
              <p className="text-xs">
                {[label.brand, label.rawText.slice(0, 80)].filter(Boolean).join(" · ") ||
                  "No extra text stored"}
              </p>
            </div>
          )}
          {receipt && (
            <p className="mt-3 text-sm text-muted">
              {receipt.items.length} lines
              {receipt.total != null ? ` · ${money(receipt.total, receipt.currency ?? "AED")}` : ""}
            </p>
          )}

          <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-subtle">Reprocess with</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {engines.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRead(opt.id)}
                className={cn(
                  "h-10 rounded-lg px-3 text-sm",
                  read === opt.id ? "bg-fg text-bg" : "bg-elevated text-muted",
                )}
              >
                {opt.title}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void reprocess()} disabled={Boolean(busy) || !image}>
              <RefreshCw className="size-4" />
              {busy === "read" ? "Reading…" : "Reprocess"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
              <ImagePlus className="size-4" />
              Replace photo
            </Button>
            <Button type="button" variant="ghost" className="text-muted" onClick={() => void remove()} disabled={Boolean(busy)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void replacePhoto(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
