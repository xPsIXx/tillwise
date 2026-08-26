import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createTrip, listTrips } from "@/lib/grocery/server";
import { money, statusLabel, tripDay } from "@/lib/grocery/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [store, setStore] = useState("");
  const tripsQuery = useQuery({
    queryKey: ["trips"],
    queryFn: () => listTrips(),
  });
  const start = useMutation({
    mutationFn: () => createTrip({ data: { storeName: store.trim() || undefined } }),
    onSuccess: (trip) => {
      qc.setQueryData(["trips"], (old: unknown) => {
        const list = Array.isArray(old) ? old : [];
        return [trip, ...list.filter((t: { id: number }) => t.id !== trip.id)];
      });
      void qc.invalidateQueries({ queryKey: ["trips"] });
      void navigate({ to: "/scan", search: { tripId: trip.id, mode: "label" } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not start trip"),
  });

  if (tripsQuery.isLoading) {
    return (
      <div className="py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-36 w-full" />
      </div>
    );
  }

  const trips = tripsQuery.data ?? [];
  const active = trips.find((t) => t.status !== "complete");
  const filed = trips.filter((t) => t.status === "complete");
  const spent = filed.reduce((acc, t) => acc + (t.receiptTotal ?? 0), 0);

  return (
    <main className="pb-8 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Your ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Ready when you are</h1>

      {active ? (
        <section className="mt-6 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <p className="text-xs uppercase tracking-[0.16em] text-subtle">Open trip</p>
          <h2 className="mt-1 font-display text-2xl">{active.storeName ?? "Shopping trip"}</h2>
          <p className="mt-1 text-sm text-muted">
            {statusLabel(active.status)} · {active.itemCount} item{active.itemCount === 1 ? "" : "s"} ·{" "}
            {active.receiptCaptureCount} receipt portion{active.receiptCaptureCount === 1 ? "" : "s"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/scan" search={{ tripId: active.id, mode: "label" }}>
                Continue scanning
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/trip/$tripId" params={{ tripId: String(active.id) }}>
                Open trip
              </Link>
            </Button>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-2xl">New shopping trip</h2>
          <p className="mt-1 text-sm text-muted">Optional — you can name the store later from the receipt.</p>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Input
              placeholder="Store name, e.g. Carrefour Yas Mall"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={start.isPending}>
              {start.isPending ? "Starting…" : "Start trip"}
            </Button>
          </form>
        </section>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-3">
        <StatCard label="Filed trips" value={String(filed.length)} />
        <StatCard
          label="Logged spend"
          value={money(spent, filed[0]?.currency ?? "AED")}
        />
      </dl>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Recent</h2>
          <div className="flex gap-3">
            <Link to="/analytics" className="text-sm text-muted hover:text-fg">
              Analytics
            </Link>
            <Link to="/prices" className="text-sm text-muted hover:text-fg">
              Prices
            </Link>
            <Link to="/trips" className="text-sm text-muted hover:text-fg">
              All trips
            </Link>
          </div>
        </div>
        {filed.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing filed yet. Scan a few labels — or try the sample stickers in the scanner.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {filed.slice(0, 4).map((trip) => (
              <li key={trip.id}>
                <Link
                  to="/trip/$tripId"
                  params={{ tripId: String(trip.id) }}
                  className={cn(
                    "flex items-center justify-between rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]",
                  )}
                >
                  <div>
                    <p className="font-medium">{trip.storeName ?? "Shopping trip"}</p>
                    <p className="text-xs text-muted">
                      {tripDay(trip.completedAt ?? trip.startedAt)} · {trip.itemCount} items
                    </p>
                  </div>
                  <p className="tabular-nums text-sm">
                    {money(trip.receiptTotal, trip.currency)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
