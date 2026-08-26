import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { listRecentShots, listTrips } from "@/lib/grocery/server";
import { money, statusLabel, tripDay } from "@/lib/grocery/format";

export const Route = createFileRoute("/trips")({ component: TripsPage });

function TripsPage() {
  const tripsQuery = useQuery({
    queryKey: ["trips"],
    queryFn: () => listTrips(),
  });
  const shotsQuery = useQuery({
    queryKey: ["shots"],
    queryFn: () => listRecentShots(),
  });

  const trips = tripsQuery.data ?? [];
  const shots = (shotsQuery.data ?? []).slice(0, 8);

  return (
    <main className="pb-8 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Trips</h1>

      {shots.length > 0 && (
        <section className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-display text-xl">Recent shots</h2>
            <div className="flex gap-3">
              <Link to="/prices" className="text-xs text-muted hover:text-fg">
                Prices
              </Link>
              <Link to="/shots" className="text-xs text-muted hover:text-fg">
                All photos
              </Link>
            </div>
          </div>
          <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {shots.map((shot) => (
              <li key={shot.id} className="w-20 shrink-0">
                <Link
                  to="/trip/$tripId"
                  params={{ tripId: String(shot.tripId) }}
                  className="block"
                >
                  {shot.thumbnailData ? (
                    <img
                      src={shot.thumbnailData}
                      alt=""
                      className="h-24 w-20 rounded-md object-cover"
                    />
                  ) : (
                    <div className="grid h-24 w-20 place-items-center rounded-md bg-elevated text-[10px] text-subtle">
                      Shot
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tripsQuery.isLoading ? (
        <Skeleton className="mt-6 h-32 w-full" />
      ) : trips.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          No trips yet. Start one from Home, then scan labels in the aisle.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link
                to="/trip/$tripId"
                params={{ tripId: String(trip.id) }}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{trip.storeName ?? "Shopping trip"}</p>
                    <Badge tone={trip.status === "complete" ? "ok" : "muted"}>
                      {statusLabel(trip.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {tripDay(trip.completedAt ?? trip.startedAt)} · {trip.itemCount} items
                    {trip.receiptCaptureCount
                      ? ` · ${trip.receiptCaptureCount} receipt shots`
                      : ""}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums text-sm">
                  {money(trip.receiptTotal, trip.currency)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
