import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { listTrips } from "@/lib/grocery/server";
import { money, statusLabel, tripDay } from "@/lib/grocery/format";

export const Route = createFileRoute("/trips")({ component: TripsPage });

function TripsPage() {
  const tripsQuery = useQuery({
    queryKey: ["trips"],
    queryFn: () => listTrips(),
  });

  const trips = tripsQuery.data ?? [];

  return (
    <main className="pb-8 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Trips</h1>
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
