import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemCard } from "@/components/trip/item-card";
import {
  collateTrip,
  completeTrip,
  deleteItem,
  deleteReceiptCapture,
  deleteTrip,
  getTrip,
  updateItem,
  updateTrip,
} from "@/lib/grocery/server";
import { money, statusLabel, tripDate } from "@/lib/grocery/format";
import { loadScanSettings } from "@/lib/grocery/settings";
import type { TripItem } from "@/lib/grocery/types";

export const Route = createFileRoute("/trip/$tripId")({ component: TripPage });

function TripPage() {
  const { tripId: tripIdParam } = Route.useParams();
  const tripId = Number(tripIdParam);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TripItem | null>(null);
  const [store, setStore] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => getTrip({ data: tripId }),
    enabled: Number.isFinite(tripId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["trip", tripId] });
    void qc.invalidateQueries({ queryKey: ["trips"] });
  };

  const collate = useMutation({
    mutationFn: () => collateTrip({ data: { tripId, provider: loadScanSettings().collate } }),
    onSuccess: () => {
      toast.success("Trip collated");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not collate"),
  });

  const finish = useMutation({
    mutationFn: () => completeTrip({ data: tripId }),
    onSuccess: () => {
      toast.success("Trip filed");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not file trip"),
  });

  const removeTrip = useMutation({
    mutationFn: () => deleteTrip({ data: tripId }),
    onSuccess: () => {
      toast.success("Trip deleted");
      void navigate({ to: "/trips" });
      invalidate();
    },
  });

  const saveStore = useMutation({
    mutationFn: (name: string) =>
      updateTrip({ data: { tripId, storeName: name || null } }),
    onSuccess: invalidate,
  });

  const saveItem = useMutation({
    mutationFn: (item: TripItem) =>
      updateItem({
        data: {
          itemId: item.id,
          patch: {
            name: item.name,
            quantity: item.quantity,
            quantityUnit: item.quantityUnit,
            weightValue: item.weightValue,
            weightUnit: item.weightUnit,
            linePrice: item.linePrice,
            unitPrice: item.unitPrice,
          },
        },
      }),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => deleteItem({ data: id }),
    onSuccess: invalidate,
  });

  const removeCapture = useMutation({
    mutationFn: (id: number) => deleteReceiptCapture({ data: id }),
    onSuccess: invalidate,
  });

  if (!Number.isFinite(tripId)) {
    return <p className="py-10 text-sm text-muted">Missing trip.</p>;
  }
  if (detailQuery.isLoading) {
    return (
      <div className="py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <main className="py-16 text-center">
        <h1 className="font-display text-3xl">Trip not found</h1>
        <Button asChild className="mt-4" variant="secondary">
          <Link to="/trips">Back to trips</Link>
        </Button>
      </main>
    );
  }

  const { trip, items, receipts } = detailQuery.data;
  const storeValue = store ?? trip.storeName ?? "";
  const sum = items.reduce((acc, it) => acc + (it.linePrice ?? 0), 0);
  const labels = items.filter((i) => i.source === "label" && i.matchStatus !== "processing");
  const merged = items.filter((i) => i.source === "merged");
  const visible = merged.length ? merged : items;

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {statusLabel(trip.status)} · {tripDate(trip.startedAt)}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <label className="block min-w-0 flex-1">
          <span className="sr-only">Store name</span>
          <input
            value={storeValue}
            onChange={(e) => setStore(e.target.value)}
            onBlur={() => {
              if ((store ?? "") !== (trip.storeName ?? "")) {
                saveStore.mutate(storeValue);
              }
            }}
            placeholder="Store name"
            className="w-full bg-transparent font-display text-4xl tracking-tight outline-none placeholder:text-subtle"
          />
        </label>
        <p className="font-display text-3xl tabular-nums">
          {money(trip.receiptTotal ?? sum, trip.currency)}
        </p>
      </div>
      {trip.storeLocation && (
        <p className="mt-1 text-sm text-muted">{trip.storeLocation}</p>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2">
        <Mini label="Subtotal" value={money(trip.receiptSubtotal ?? sum, trip.currency)} />
        <Mini label="VAT" value={money(trip.receiptTax, trip.currency)} />
        <Mini label="Items" value={String(visible.length)} />
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        {trip.status !== "complete" && (
          <>
            <Button asChild>
              <Link to="/scan" search={{ tripId: trip.id, mode: "label" }}>
                Scan labels
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/scan" search={{ tripId: trip.id, mode: "receipt" }}>
                Scan receipt
              </Link>
            </Button>
            <Button
              variant="accent"
              disabled={collate.isPending || (labels.length === 0 && receipts.length === 0)}
              onClick={() => collate.mutate()}
            >
              {collate.isPending ? "Collating…" : "Collate trip"}
            </Button>
            {trip.status === "review" && (
              <Button variant="primary" onClick={() => finish.mutate()} disabled={finish.isPending}>
                {finish.isPending ? "Filing…" : "File trip"}
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" className="text-muted" onClick={() => removeTrip.mutate()}>
          Delete
        </Button>
      </div>

      {receipts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-2xl">Receipt portions</h2>
          <p className="mt-1 text-sm text-muted">
            Long till tapes can be shot in pieces. Collate stitches and error-corrects them.
          </p>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {receipts.map((cap) => (
              <li key={cap.id} className="w-28 shrink-0">
                {cap.thumbnailData ? (
                  <img
                    src={cap.thumbnailData}
                    alt=""
                    className="h-36 w-28 rounded-md object-cover"
                  />
                ) : (
                  <div className="grid h-36 w-28 place-items-center rounded-md bg-elevated text-xs text-subtle">
                    Portion {cap.sequence + 1}
                  </div>
                )}
                <p className="mt-1 truncate text-xs text-muted">
                  {cap.extracted?.items.length ?? 0} lines
                  {cap.extracted?.portionHint ? ` · ${cap.extracted.portionHint}` : ""}
                </p>
                {trip.status !== "complete" && (
                  <button
                    type="button"
                    className="text-xs text-subtle hover:text-fg"
                    onClick={() => removeCapture.mutate(cap.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-2xl">
          {merged.length ? "Collated items" : "Cart"}
        </h2>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing scanned yet. Open the camera and frame a produce sticker — or try a sample.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((item) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  currency={trip.currency}
                  onEdit={trip.status === "complete" ? undefined : setEditing}
                  onDelete={
                    trip.status === "complete"
                      ? undefined
                      : (it) => removeItem.mutate(it.id)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-40 grid place-items-end bg-bg/50 p-4 sm:place-items-center">
          <form
            className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]"
            onSubmit={(e) => {
              e.preventDefault();
              saveItem.mutate(editing);
            }}
          >
            <h3 className="font-display text-2xl">Correct this line</h3>
            <div className="mt-4 grid gap-3">
              <label className="text-xs text-muted">
                Name
                <Input
                  className="mt-1"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted">
                  Weight
                  <Input
                    className="mt-1"
                    inputMode="decimal"
                    value={editing.weightValue ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        weightValue: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-muted">
                  Unit
                  <Input
                    className="mt-1"
                    value={editing.weightUnit ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, weightUnit: e.target.value || null })
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted">
                  Quantity
                  <Input
                    className="mt-1"
                    inputMode="decimal"
                    value={editing.quantity ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        quantity: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="text-xs text-muted">
                  Line price
                  <Input
                    className="mt-1"
                    inputMode="decimal"
                    value={editing.linePrice ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        linePrice: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saveItem.isPending}>
                {saveItem.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2 shadow-[var(--shadow-border)]">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="tabular-nums text-sm font-medium">{value}</dd>
    </div>
  );
}
