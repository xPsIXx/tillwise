import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ShotGallery } from "@/components/trip/shot-gallery";
import { ShotSheet } from "@/components/trip/shot-sheet";
import { listRecentShots } from "@/lib/grocery/server";
import type { ScanShot } from "@/lib/grocery/types";

export const Route = createFileRoute("/shots")({ component: ShotsPage });

function ShotsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ScanShot | null>(null);
  const shotsQuery = useQuery({
    queryKey: ["shots"],
    queryFn: () => listRecentShots(),
  });
  const shots = shotsQuery.data ?? [];

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">History</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Pictures</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Every label and till photo stays here. Open one to re-read it with a different engine, or
        replace a blurry frame.
      </p>
      {shotsQuery.isLoading ? (
        <Skeleton className="mt-6 h-48 w-full" />
      ) : shots.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          No photos yet.{" "}
          <Link to="/scan" className="text-fg underline-offset-2 hover:underline">
            Scan a label
          </Link>{" "}
          and it will land here.
        </p>
      ) : (
        <ShotGallery shots={shots} onOpen={setOpen} />
      )}
      {open && (
        <ShotSheet
          shot={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["shots"] });
            void qc.invalidateQueries({ queryKey: ["trips"] });
            void qc.invalidateQueries({ queryKey: ["trip", open.tripId] });
            void shotsQuery.refetch().then((res) => {
              const next = res.data?.find((s) => s.id === open.id);
              if (next) setOpen(next);
            });
          }}
        />
      )}
    </main>
  );
}
