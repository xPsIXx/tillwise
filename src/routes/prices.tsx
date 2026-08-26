import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { listPriceHistory, listRememberedProducts } from "@/lib/grocery/server";
import { money, tripDay } from "@/lib/grocery/format";
import type { ProductMemory } from "@/lib/grocery/types";

export const Route = createFileRoute("/prices")({ component: PricesPage });

function PricesPage() {
  const [open, setOpen] = useState<ProductMemory | null>(null);
  const products = useQuery({
    queryKey: ["catalog"],
    queryFn: () => listRememberedProducts(),
  });
  const history = useQuery({
    queryKey: ["prices", open?.barcode, open?.name],
    queryFn: () =>
      listPriceHistory({
        data: { barcode: open?.barcode, name: open?.name, limit: 20 },
      }),
    enabled: Boolean(open),
  });

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Prices</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Barcodes and names remembered from filed trips. Open one to see what you paid last time.
      </p>
      {products.isLoading ? (
        <Skeleton className="mt-6 h-40 w-full" />
      ) : (products.data ?? []).length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          Nothing remembered yet. Scan a barcode or file a trip and it will show up here.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {(products.data ?? []).map((p) => (
            <li key={`${p.barcode ?? "n"}-${p.nameKey}`}>
              <button
                type="button"
                onClick={() => setOpen(p)}
                className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 text-left shadow-[var(--shadow-border)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted">
                    {[p.brand, p.barcode, `${p.seenCount} time${p.seenCount === 1 ? "" : "s"}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm">
                  <span className="block tabular-nums">
                    {money(p.lastLinePrice ?? p.lastUnitPrice, p.currency ?? "AED")}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {p.lastUnitPrice != null
                      ? `${money(p.lastUnitPrice, p.currency ?? "AED")} /kg`
                      : "no unit price"}
                  </span>
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          className="fixed inset-0 z-40 grid place-items-end bg-bg/55 sm:place-items-center sm:p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-[var(--shadow-border)] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs uppercase tracking-[0.16em] text-muted">Price history</p>
            <h2 className="font-display text-2xl">{open.name}</h2>
            <p className="mt-1 text-sm text-muted">
              {[open.brand, open.barcode].filter(Boolean).join(" · ") || "No barcode stored"}
            </p>
            {history.isLoading ? (
              <p className="mt-4 text-sm text-muted">Loading…</p>
            ) : (history.data ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-muted">No priced trips for this product yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border text-sm">
                {(history.data ?? []).map((pt) => (
                  <li key={pt.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-muted">
                      {tripDay(pt.observedAt)}
                      {pt.storeName ? ` · ${pt.storeName}` : ""}
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block">{money(pt.linePrice ?? pt.unitPrice, pt.currency)}</span>
                      {pt.unitPrice != null ? (
                        <span className="block text-[11px] text-muted">
                          {money(pt.unitPrice, pt.currency)} /{pt.weightUnit || "kg"}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="mt-5 h-11 w-full rounded-lg bg-elevated text-sm font-medium"
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
