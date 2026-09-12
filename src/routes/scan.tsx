import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView } from "@/components/scanner/camera-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createTrip, listTrips } from "@/lib/grocery/server";
import type { ScanMode } from "@/lib/grocery/types";

type ScanSearch = {
  tripId?: number;
  mode?: ScanMode;
  contribute?: boolean;
};

function parseSearch(search: Record<string, unknown>): ScanSearch {
  const rawId = search.tripId;
  const tripIdNum = typeof rawId === "number" ? rawId : Number(rawId);
  const tripId =
    rawId != null && rawId !== "" && Number.isFinite(tripIdNum) ? tripIdNum : undefined;
  const mode: ScanMode | undefined =
    search.mode === "receipt" ? "receipt" : search.mode === "label" ? "label" : undefined;
  const contribute = search.contribute === true || search.contribute === "true";
  return { tripId, mode, contribute: contribute || undefined };
}

export const Route = createFileRoute("/scan")({
  validateSearch: parseSearch,
  component: ScanPage,
});

function ScanPage() {
  const { tripId, mode, contribute } = Route.useSearch();
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

  if (tripsQuery.isLoading && !tripId && !contribute) {
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

  function setContribute(on: boolean) {
    void navigate({
      to: "/scan",
      search: on
        ? { tripId: activeId, mode: "label", contribute: true }
        : { tripId: activeId, mode: mode === "receipt" ? "receipt" : "label" },
      replace: true,
    });
  }

  if (contribute) {
    return (
      <CameraView
        tripId={activeId}
        storeName={active?.storeName ?? null}
        mode="label"
        contribute
        onContribute={setContribute}
        onMode={() => undefined}
        onClose={() => {
          if (activeId) void navigate({ to: "/trip/$tripId", params: { tripId: String(activeId) } });
          else void navigate({ to: "/" });
        }}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: ["produce-prices"] });
          void qc.invalidateQueries({ queryKey: ["catalog"] });
          void qc.invalidateQueries({ queryKey: ["analytics"] });
        }}
      />
    );
  }

  if (!activeId) {
    return (
      <main className="py-16 text-center">
        <h1 className="font-display text-3xl">Start a trip first</h1>
        <p className="mt-2 text-sm text-muted">
          Every shopping scan belongs to a trip so labels and the till can be collated later.
        </p>
        <Button className="mt-6" onClick={() => start.mutate()} disabled={start.isPending}>
          {start.isPending ? "Starting…" : "Start shopping"}
        </Button>
        <p className="mt-4">
          <Link to="/scan" search={{ contribute: true }} className="text-sm underline-offset-2 hover:underline">
            Or log a shelf price (not a trip)
          </Link>
        </p>
      </main>
    );
  }

  const scanMode: ScanMode = mode === "receipt" ? "receipt" : "label";

  return (
    <CameraView
      tripId={activeId}
      storeName={active?.storeName ?? null}
      mode={scanMode}
      onContribute={setContribute}
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
