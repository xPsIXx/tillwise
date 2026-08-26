import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView } from "@/components/scanner/camera-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createTrip, listTrips } from "@/lib/grocery/server";
import type { ScanMode } from "@/lib/grocery/types";

type ScanSearch = {
  tripId?: number;
  mode?: ScanMode;
};

function parseSearch(search: Record<string, unknown>): ScanSearch {
  const rawId = search.tripId;
  const tripIdNum = typeof rawId === "number" ? rawId : Number(rawId);
  const tripId =
    rawId != null && rawId !== "" && Number.isFinite(tripIdNum) ? tripIdNum : undefined;
  const mode: ScanMode | undefined =
    search.mode === "receipt" ? "receipt" : search.mode === "label" ? "label" : undefined;
  return { tripId, mode };
}

export const Route = createFileRoute("/scan")({
  validateSearch: parseSearch,
  component: ScanPage,
});

function ScanPage() {
  const { tripId, mode } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tripsQuery = useQuery({
    queryKey: ["trips"],
    queryFn: () => listTrips(),
  });
  const start = useMutation({
    mutationFn: () => createTrip({ data: {} }),
    onSuccess: (trip) => {
      qc.setQueryData(["trips"], (old: unknown) => {
        const list = Array.isArray(old) ? old : [];
        return [trip, ...list.filter((t: { id: number }) => t.id !== trip.id)];
      });
      void qc.invalidateQueries({ queryKey: ["trips"] });
      void navigate({ to: "/scan", search: { tripId: trip.id, mode: "label" } });
    },
  });

  if (tripsQuery.isLoading && !tripId) {
    return (
      <div className="py-16">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const active =
    (tripId ? tripsQuery.data?.find((t) => t.id === tripId) : undefined) ??
    tripsQuery.data?.find((t) => t.status !== "complete");
  const activeId = active?.id ?? tripId;

  if (!activeId) {
    return (
      <main className="py-16 text-center">
        <h1 className="font-display text-3xl">Start a trip first</h1>
        <p className="mt-2 text-sm text-muted">
          Every scan belongs to a shopping trip so labels and the till can be collated later.
        </p>
        <Button className="mt-6" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start shopping"}
        </Button>
      </main>
    );
  }

  const scanMode: ScanMode = mode === "receipt" ? "receipt" : "label";

  return (
    <CameraView
      tripId={activeId}
      mode={scanMode}
      onMode={(next) => {
        void navigate({
          to: "/scan",
          search: { tripId: activeId, mode: next },
          replace: true,
        });
      }}
      onClose={() => {
        void navigate({ to: "/trip/$tripId", params: { tripId: String(activeId) } });
      }}
      onSaved={() => {
        void qc.invalidateQueries({ queryKey: ["trips"] });
        void qc.invalidateQueries({ queryKey: ["trip", activeId] });
      }}
    />
  );
}
