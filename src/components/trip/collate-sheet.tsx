import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/grocery/format";
import type { CollatePair, CollatePreview } from "@/lib/grocery/types";

export function CollateSheet({
  preview,
  onCancel,
  onConfirm,
  busy,
}: {
  preview: CollatePreview;
  onCancel: () => void;
  onConfirm: (pairs: { labelItemId: number | null; receiptIndex: number | null }[]) => void;
  busy: boolean;
}) {
  const [rows, setRows] = useState<CollatePair[]>(preview.rows);
  const [pick, setPick] = useState<CollatePair | null>(null);

  const matched = rows.filter((r) => r.labelItemId != null && r.receiptIndex != null);
  const labelOnly = rows.filter((r) => r.labelItemId != null && r.receiptIndex == null);
  const tillOnly = rows.filter((r) => r.labelItemId == null);

  const lineSum = useMemo(
    () => Math.round(rows.reduce((acc, r) => acc + (r.item.linePrice ?? 0), 0) * 100) / 100,
    [rows],
  );
  const gap =
    preview.total != null ? Math.round((lineSum - preview.total) * 100) / 100 : null;

  function unmatch(row: CollatePair) {
    if (row.labelItemId == null || row.receiptIndex == null) return;
    const till: CollatePair = {
      labelItemId: null,
      receiptIndex: row.receiptIndex,
      aisleName: row.tillName ?? row.aisleName,
      tillName: row.tillName,
      item: {
        ...row.item,
        name: row.tillName ?? row.aisleName,
        matchStatus: "receipt_only",
        matchConfidence: null,
        thumbnailData: null,
        tillName: row.tillName,
        unitPrice: row.item.unitPrice,
        linePrice: row.item.linePrice,
      },
    };
    const label: CollatePair = {
      ...row,
      receiptIndex: null,
      tillName: null,
      item: {
        ...row.item,
        matchStatus: "label_only",
        matchConfidence: null,
        tillName: null,
        unitPrice: null,
        linePrice: null,
      },
    };
    setRows((prev) => [...prev.filter((r) => r !== row), label, till]);
    setPick(null);
  }

  function pairHand(label: CollatePair, till: CollatePair) {
    if (label.labelItemId == null || till.receiptIndex == null) return;
    const merged: CollatePair = {
      labelItemId: label.labelItemId,
      receiptIndex: till.receiptIndex,
      aisleName: label.aisleName,
      tillName: till.tillName ?? till.aisleName,
      item: {
        ...label.item,
        matchStatus: "matched",
        matchConfidence: 1,
        tillName: till.tillName ?? till.aisleName,
        unitPrice: till.item.unitPrice ?? label.item.unitPrice,
        linePrice: till.item.linePrice ?? label.item.linePrice,
      },
    };
    setRows((prev) => [...prev.filter((r) => r !== label && r !== till), merged]);
    setPick(null);
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-bg/50 p-4 sm:place-items-center"
      onClick={onCancel}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-2xl">Check the merge</h3>
        <p className="mt-1 text-sm text-muted">
          Matched is a shelf label plus a till line. Nothing is saved until you confirm.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-elevated px-3 py-2">
            <dt className="text-xs text-subtle">Printed total</dt>
            <dd className="tabular-nums font-medium">{money(preview.total, preview.currency)}</dd>
          </div>
          <div className="rounded-xl bg-elevated px-3 py-2">
            <dt className="text-xs text-subtle">Line sum</dt>
            <dd className="tabular-nums font-medium">{money(lineSum, preview.currency)}</dd>
          </div>
        </dl>
        {gap != null && Math.abs(gap) >= 0.02 ? (
          <p className="mt-3 rounded-md bg-elevated px-3 py-2 text-sm">
            Lines are {money(Math.abs(gap), preview.currency)} {gap > 0 ? "over" : "under"} the
            printed till total. The printed total stays.
          </p>
        ) : null}

        {matched.length > 0 && (
          <section className="mt-5">
            <h4 className="text-sm font-medium">Matched · {matched.length}</h4>
            <ul className="mt-2 space-y-2">
              {matched.map((row, i) => (
                <li key={`m-${row.labelItemId}-${i}`} className="rounded-xl bg-elevated p-3 text-sm">
                  <p className="font-medium">{row.aisleName}</p>
                  <p className="text-xs text-muted">Till: {row.tillName}</p>
                  <p className="mt-1 tabular-nums">{money(row.item.linePrice, preview.currency)}</p>
                  <button
                    type="button"
                    className="mt-1 text-xs text-subtle hover:text-fg"
                    onClick={() => unmatch(row)}
                  >
                    Unmatch
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {labelOnly.length > 0 && (
          <section className="mt-5">
            <h4 className="text-sm font-medium">Label only · {labelOnly.length}</h4>
            <p className="mt-1 text-xs text-muted">Tap a label, then a till line to pair them.</p>
            <ul className="mt-2 space-y-1 text-sm">
              {labelOnly.map((row) => (
                <li key={`l-${row.labelItemId}`}>
                  <button
                    type="button"
                    className={
                      pick?.labelItemId === row.labelItemId
                        ? "w-full rounded-md bg-bg px-2 py-1 text-left font-medium"
                        : "w-full rounded-md px-2 py-1 text-left"
                    }
                    onClick={() =>
                      setPick((cur) => (cur?.labelItemId === row.labelItemId ? null : row))
                    }
                  >
                    {row.aisleName}
                    {pick?.labelItemId === row.labelItemId ? " · selected" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {tillOnly.length > 0 && (
          <section className="mt-5">
            <h4 className="text-sm font-medium">Till only · {tillOnly.length}</h4>
            <ul className="mt-2 space-y-1 text-sm">
              {tillOnly.map((row, i) => (
                <li key={`t-${row.receiptIndex}-${i}`}>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1 text-left"
                    onClick={() => {
                      if (pick) pairHand(pick, row);
                    }}
                  >
                    {row.tillName}{" "}
                    <span className="tabular-nums text-muted">
                      {money(row.item.linePrice, preview.currency)}
                    </span>
                    {pick ? " · tap to pair" : ""}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-5 flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              onConfirm(
                rows.map((r) => ({
                  labelItemId: r.labelItemId,
                  receiptIndex: r.receiptIndex,
                })),
              )
            }
          >
            {busy ? "Saving…" : "Confirm merge"}
          </Button>
        </div>
      </div>
    </div>
  );
}
