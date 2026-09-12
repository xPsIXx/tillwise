import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { generateCommonNames, getGroceryAnalytics, listProducePrices, fixProduceKey } from "@/lib/grocery/server";
import { money, tripDay, unitMoney } from "@/lib/grocery/format";
import { loadScanSettings } from "@/lib/grocery/settings";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

function AnalyticsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["analytics"],
    queryFn: () => getGroceryAnalytics(),
  });
  const produce = useQuery({
    queryKey: ["produce-prices"],
    queryFn: () => listProducePrices(),
  });
  const build = useMutation({
    mutationFn: () => generateCommonNames({ data: { provider: loadScanSettings().collate } }),
    onSuccess: (res) => {
      toast.success(`Mapped ${res.mapped} printed name${res.mapped === 1 ? "" : "s"} for stats`);
      void qc.invalidateQueries({ queryKey: ["analytics"] });
      void qc.invalidateQueries({ queryKey: ["canonical-products"] });
      void qc.invalidateQueries({ queryKey: ["produce-prices"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not build common names"),
  });

  if (query.isLoading) {
    return (
      <main className="pb-10 pt-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-40 w-full" />
      </main>
    );
  }

  const data = query.data;
  if (!data || data.tripCount === 0) {
    return (
      <main className="pb-10 pt-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Analytics</h1>
        <p className="mt-3 max-w-xl text-sm text-muted">
          File a trip with a till total and this page fills in: spend over time, store trends, and
          unit-price movement.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = new FormData(e.currentTarget).get("q");
            if (typeof q === "string" && q.trim()) {
              void navigate({ to: "/search", search: { q: q.trim() } });
            }
          }}
        >
          <Input name="q" placeholder="Search trips…" className="flex-1" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Link to="/trips" className="mt-4 inline-block text-sm underline-offset-2 hover:underline">
          Open trips
        </Link>
      </main>
    );
  }

  const maxMonth = Math.max(...data.months.map((m) => m.spend), 1);
  const maxStore = Math.max(...data.stores.map((s) => s.spend), 1);

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Analytics</h1>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q");
          if (typeof q === "string" && q.trim()) {
            void navigate({ to: "/search", search: { q: q.trim() } });
          }
        }}
      >
        <Input name="q" placeholder="Search trips…" className="flex-1" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Compared across stores from filed trips. Carts keep the sticker wording (Australian
        Carrots). Filing a trip maps stats keys in the background — country dropped, variety kept
        (Cherry Tomatoes stay Cherry Tomatoes).
      </p>
      <div className="mt-4">
        <Button onClick={() => build.mutate()} disabled={build.isPending} variant="secondary">
          {build.isPending ? "Mapping names…" : "Remap old trips"}
        </Button>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Spend" value={money(data.totalSpend, data.currency)} />
        <Stat label="Trips" value={String(data.tripCount)} />
        <Stat label="Avg basket" value={money(data.avgBasket, data.currency)} />
      </dl>

      <ProduceBoard
        rows={produce.data ?? []}
        loading={produce.isLoading}
        openKey={openKey}
        onOpen={setOpenKey}
      />

      <section className="mt-8">
        <h2 className="font-display text-2xl">Spending over time</h2>
        {data.months.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No dated totals yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {data.months.map((m) => (
              <li key={m.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
                <span className="text-muted">{m.label}</span>
                <span className="h-3 overflow-hidden rounded-full bg-elevated">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(6, (m.spend / maxMonth) * 100)}%` }}
                  />
                </span>
                <span className="tabular-nums">{money(m.spend, data.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl">Stores</h2>
        <ul className="mt-4 space-y-3">
          {data.stores.map((s) => (
            <li key={s.store} className="rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate font-medium">{s.store}</p>
                <p className="tabular-nums text-sm">{money(s.spend, data.currency)}</p>
              </div>
              <p className="mt-1 text-xs text-muted">
                {s.trips} trip{s.trips === 1 ? "" : "s"} · avg {money(s.avgBasket, data.currency)}
                {s.lastVisit ? ` · last ${tripDay(s.lastVisit)}` : ""}
              </p>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-elevated">
                <span
                  className="block h-full rounded-full bg-fg/70"
                  style={{ width: `${Math.max(6, (s.spend / maxStore) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">Prices going up</h2>
          {data.risers.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Need the same product on two trips.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {data.risers.map((m) => (
                <li key={`${m.productId}-${m.name}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-red-400">
                    +{m.changePct.toFixed(0)}% · {unitMoney(m.to, m.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="font-display text-2xl">Prices easing</h2>
          {data.fallers.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No drops recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {data.fallers.map((m) => (
                <li key={`${m.productId}-${m.name}`} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="shrink-0 tabular-nums text-accent">
                    {m.changePct.toFixed(0)}% · {unitMoney(m.to, m.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Unit price by store</h2>
          <Link to="/prices" className="text-sm text-muted hover:text-fg">
            Full history
          </Link>
        </div>
        {data.cheapestUnit.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Scan produce stickers to compare AED/kg across shops.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {data.cheapestUnit.map((row) => (
              <li
                key={`${row.productId}-${row.store}-${row.observedAt}`}
                className="flex items-baseline justify-between gap-3 py-2"
              >
                <span className="min-w-0 truncate">
                  {row.name}
                  <span className="text-muted"> · {row.store}</span>
                </span>
                <span className="shrink-0 tabular-nums">{unitMoney(row.unitPrice, row.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProduceBoard({
  rows,
  loading,
  openKey,
  onOpen,
}: {
  rows: Awaited<ReturnType<typeof listProducePrices>>;
  loading: boolean;
  openKey: string | null;
  onOpen: (key: string | null) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">Produce prices</h2>
      <p className="mt-1 text-sm text-muted">
        AED/kg by shop. Cheapest store first. Tap a line for history. Variety is kept; country is
        not (Gala is Gala; cherry tomato is not tomato).
      </p>
      {loading ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">File a trip with sticker prices to fill this.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((row) => {
            const open = openKey === row.key;
            return (
              <li key={row.key} className="rounded-xl bg-surface shadow-[var(--shadow-border)]">
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => onOpen(open ? null : row.key)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{row.name}</span>
                    <span className="block text-xs text-muted">
                      Cheapest at {row.cheapestStore}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums text-sm">
                      {unitMoney(row.cheapestUnit, row.currency)}
                    </span>
                    {row.changePct != null ? (
                      <span
                        className={
                          row.changePct > 1
                            ? "text-xs tabular-nums text-red-400"
                            : row.changePct < -1
                              ? "text-xs tabular-nums text-accent"
                              : "text-xs tabular-nums text-muted"
                        }
                      >
                        {row.changePct > 0 ? "+" : ""}
                        {row.changePct.toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                </button>
                {open ? (
                  <div className="border-t border-border px-4 py-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-subtle">Shops</p>
                    <ul className="mt-2 space-y-1">
                      {row.stores.map((s) => (
                        <li key={s.store} className="flex justify-between gap-3">
                          <span className="truncate">{s.store}</span>
                          <span className="tabular-nums">
                            {unitMoney(s.unitPrice, row.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-xs uppercase tracking-wide text-subtle">History</p>
                    <ul className="mt-2 space-y-1 text-muted">
                      {[...row.history].reverse().map((h, i) => (
                        <li key={`${h.observedAt}-${i}`} className="flex justify-between gap-3">
                          <span className="truncate">
                            {tripDay(h.observedAt)} · {h.store}
                          </span>
                          <span className="tabular-nums text-fg">
                            {unitMoney(h.unitPrice, row.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <FixStatsName rowKey={row.key} current={row.name} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FixStatsName({ rowKey, current }: { rowKey: string; current: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(current);
  const fix = useMutation({
    mutationFn: () => fixProduceKey({ data: { key: rowKey, newName: name } }),
    onSuccess: (res) => {
      toast.success(`Stats name is now ${res.name}. Trip stickers are unchanged.`);
      void qc.invalidateQueries({ queryKey: ["produce-prices"] });
      void qc.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not fix name"),
  });
  return (
    <form
      className="mt-4 border-t border-border pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && name.trim() !== current) fix.mutate();
      }}
    >
      <p className="text-xs text-muted">
        Wrong stats name? This only changes how charts group the item. Carts keep the printed
        sticker (Australian Carrots stays Australian Carrots).
      </p>
      <div className="mt-2 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Stats name" />
        <Button type="submit" variant="secondary" disabled={fix.isPending || !name.trim()}>
          {fix.isPending ? "Saving…" : "Use this name"}
        </Button>
      </div>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <dt className="text-[11px] uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-xl tabular-nums">{value}</dd>
    </div>
  );
}
