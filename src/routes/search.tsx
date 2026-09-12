import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { searchLedger } from "@/lib/grocery/server";
import { money, tripDay } from "@/lib/grocery/format";

type Search = { q?: string };

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" ? s.q : "",
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q: initial } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [q, setQ] = useState(initial ?? "");
  useEffect(() => {
    setQ(initial ?? "");
  }, [initial]);
  const query = useQuery({
    queryKey: ["search", initial],
    queryFn: () => searchLedger({ data: initial ?? "" }),
    enabled: Boolean(initial?.trim()),
  });

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Search</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Names, barcodes, till abbreviations, and store names across every trip.
      </p>
      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ search: { q: q.trim() } });
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Capsicum, Lulu, 123456…"
          className="flex-1"
        />
        <Button type="submit">Search</Button>
      </form>
      {!initial?.trim() ? (
        <p className="mt-6 text-sm text-muted">Type a product or store.</p>
      ) : query.isLoading ? (
        <Skeleton className="mt-6 h-32 w-full" />
      ) : (query.data ?? []).length === 0 ? (
        <p className="mt-6 text-sm text-muted">Nothing matched “{initial}”.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {(query.data ?? []).map((hit) => (
            <li key={hit.itemId}>
              <Link
                to="/trip/$tripId"
                params={{ tripId: String(hit.tripId) }}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{hit.name}</p>
                  <p className="truncate text-xs text-muted">
                    {[hit.storeName || "Untitled", tripDay(hit.startedAt), hit.brand, hit.barcode]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 tabular-nums text-sm">
                  {money(hit.linePrice ?? hit.unitPrice, hit.currency)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
