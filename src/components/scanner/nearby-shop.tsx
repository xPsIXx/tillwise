import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBrowserLocation, shortShopName } from "@/lib/grocery/geo";
import { nearbyOffStores, saveOffConfig } from "@/lib/grocery/server";
import type { OffStoreHit } from "@/lib/grocery/openfood";

export function NearbyShopPicker({
  onPicked,
}: {
  onPicked?: (hit: OffStoreHit) => void;
}) {
  const qc = useQueryClient();
  const [hits, setHits] = useState<OffStoreHit[] | null>(null);
  const find = useMutation({
    mutationFn: async () => {
      const fix = await getBrowserLocation();
      return nearbyOffStores({ data: { lat: fix.lat, lon: fix.lon } });
    },
    onSuccess: (rows) => {
      setHits(rows);
      if (rows.length === 0) toast.error("No grocery shops on the map near you");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not find shops"),
  });
  const pick = useMutation({
    mutationFn: (hit: OffStoreHit) =>
      saveOffConfig({
        data: {
          osmId: hit.osmId,
          osmType: hit.osmType,
          osmName: hit.name,
          lat: hit.lat ?? null,
          lon: hit.lon ?? null,
        },
      }),
    onSuccess: (cfg, hit) => {
      toast.success(`Shop set to ${shortShopName(cfg.osmName)}`);
      void qc.invalidateQueries({ queryKey: ["off-config"] });
      onPicked?.(hit);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save shop"),
  });
  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="secondary"
        disabled={find.isPending}
        onClick={() => find.mutate()}
      >
        {find.isPending ? "Finding shops…" : "Use my location"}
      </Button>
      {hits && hits.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {hits.map((hit) => (
            <li key={`${hit.osmType}-${hit.osmId}`}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"
                disabled={pick.isPending}
                onClick={() => pick.mutate(hit)}
              >
                <span className="min-w-0 truncate">{hit.name}</span>
                {hit.distanceM != null ? (
                  <span className="shrink-0 tabular-nums text-xs text-muted">
                    {hit.distanceM < 1000 ? `${hit.distanceM} m` : `${(hit.distanceM / 1000).toFixed(1)} km`}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
