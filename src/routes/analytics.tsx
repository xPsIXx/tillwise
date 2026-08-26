import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getGroceryAnalytics } from "@/lib/grocery/server";
import { money, tripDay, unitMoney } from "@/lib/grocery/format";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

function AnalyticsPage() {
  const query = useQuery({
    queryKey: ["analytics"],
    queryFn: () => getGroceryAnalytics(),
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
      <p className="mt-2 max-w-xl text-sm text-muted">
        Compared across stores from filed trips. Unit prices use the per-kilo figure when the
        scale sticker had one.
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Spend" value={money(data.totalSpend, data.currency)} />
        <Stat label="Trips" value={String(data.tripCount)} />
        <Stat label="Avg basket" value={money(data.avgBasket, data.currency)} />
      </dl>

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <dt className="text-[11px] uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-xl tabular-nums">{value}</dd>
    </div>
  );
}
