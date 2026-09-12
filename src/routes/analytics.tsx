import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { generateCommonNames, getGroceryAnalytics, listProducePrices, fixProduceKey } from "@/lib/grocery/server";
import { money, tripDay, unitMoney } from "@/lib/grocery/format";
import { loadScanSettings } from "@/lib/grocery/settings";
import type { ProduceWatch } from "@/lib/grocery/types";

export const Route = createFileRoute("/analytics")({ component: AnalyticsPage });

type View = "catalog" | "spend";
type Sort = "name" | "rising" | "cheap" | "recent";
type Filter = "all" | "up" | "down";

function AnalyticsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("catalog");
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
        <h1 className="mt-2 font-display text-4xl tracking-tight">Stats</h1>
        <p className="mt-3 max-w-xl text-sm text-muted">
          File a trip with sticker prices and a till total. Catalog fills with AED/kg by shop.
        </p>
        <Link to="/trips" className="mt-4 inline-block text-sm underline-offset-2 hover:underline">
          Open trips
        </Link>
      </main>
    );
  }

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Ledger</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Stats</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Catalog is AED/kg across shops. Carts keep the sticker wording. Stats keys drop country,
        keep variety (Gala, Cherry Tomatoes).
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip active={view === "catalog"} onClick={() => setView("catalog")}>
          Catalog
        </Chip>
        <Chip active={view === "spend"} onClick={() => setView("spend")}>
          Spend
        </Chip>
        <Button onClick={() => build.mutate()} disabled={build.isPending} variant="ghost" className="text-muted">
          {build.isPending ? "Mapping…" : "Remap old trips"}
        </Button>
        <Button asChild variant="ghost" className="text-muted">
          <Link to="/search">Search trips</Link>
        </Button>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Spend" value={money(data.totalSpend, data.currency)} />
        <Stat label="Trips" value={String(data.tripCount)} />
        <Stat label="Avg basket" value={money(data.avgBasket, data.currency)} />
      </dl>

      {view === "catalog" ? (
        <CatalogBoard
          rows={produce.data ?? []}
          loading={produce.isLoading}
          openKey={openKey}
          onOpen={setOpenKey}
        />
      ) : (
        <SpendBoard data={data} />
      )}
    </main>
  );
}

function CatalogBoard({
  rows,
  loading,
  openKey,
  onOpen,
}: {
  rows: ProduceWatch[];
  loading: boolean;
  openKey: string | null;
  onOpen: (key: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s/g, "");
    let list = rows.filter((row) => {
      if (filter === "up" && !(row.changePct != null && row.changePct > 1)) return false;
      if (filter === "down" && !(row.changePct != null && row.changePct < -1)) return false;
      if (!needle) return true;
      const blob = [row.name, row.barcode, ...row.aliases, row.cheapestStore, row.lastStore]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/\s/g, "");
      return blob.includes(needle);
    });
    list = [...list].sort((a, b) => {
      if (sort === "rising") return (b.changePct ?? -999) - (a.changePct ?? -999);
      if (sort === "cheap") return a.cheapestUnit - b.cheapestUnit;
      if (sort === "recent") return b.lastObservedAt.localeCompare(a.lastObservedAt);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [rows, q, sort, filter]);

  function exportCsv() {
    const header = ["name", "barcode", "cheapest_shop", "cheapest_aed_kg", "last_shop", "last_aed_kg", "change_pct", "seen"];
    const lines = shown.map((r) =>
      [
        r.name,
        r.barcode ?? "",
        r.cheapestStore,
        r.cheapestUnit.toFixed(2),
        r.lastStore,
        r.lastUnit.toFixed(2),
        r.changePct != null ? r.changePct.toFixed(1) : "",
        r.seenCount,
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tillwise-catalog.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported catalog CSV");
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl">Catalog</h2>
      <p className="mt-1 text-sm text-muted">
        Search a name or barcode. Tap a line for shops and history. Fix the stats name if cherry
        tomato landed on tomato — the cart sticker stays as printed.
      </p>
      <Input
        className="mt-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or barcode"
        aria-label="Search catalog"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        <Chip active={filter === "up"} onClick={() => setFilter("up")}>
          Rising
        </Chip>
        <Chip active={filter === "down"} onClick={() => setFilter("down")}>
          Falling
        </Chip>
        <Chip active={sort === "name"} onClick={() => setSort("name")}>
          A–Z
        </Chip>
        <Chip active={sort === "cheap"} onClick={() => setSort("cheap")}>
          Cheapest
        </Chip>
        <Chip active={sort === "rising"} onClick={() => setSort("rising")}>
          Biggest change
        </Chip>
        <Chip active={sort === "recent"} onClick={() => setSort("recent")}>
          Recent
        </Chip>
        <Button type="button" variant="ghost" className="text-muted" onClick={exportCsv} disabled={shown.length === 0}>
          Export CSV
        </Button>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {rows.length === 0
            ? "File a trip with sticker prices to fill this."
            : "Nothing matches that search."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((row) => {
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
                      {row.seenCount > 1 ? ` · ${row.seenCount} prices` : ""}
                      {row.barcode ? ` · ${row.barcode}` : ""}
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
                    {row.aliases.length > 0 ? (
                      <p className="mb-3 text-xs text-muted">Printed as {row.aliases.join(" · ")}</p>
                    ) : null}
                    <p className="text-xs uppercase tracking-wide text-subtle">Shops</p>
                    <ul className="mt-2 space-y-1">
                      {row.stores.map((s) => (
                        <li key={s.store} className="flex justify-between gap-3">
                          <span className="truncate">{s.store}</span>
                          <span className="tabular-nums">{unitMoney(s.unitPrice, row.currency)}</span>
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
                          <span className="tabular-nums text-fg">{unitMoney(h.unitPrice, row.currency)}</span>
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

function SpendBoard({ data }: { data: NonNullable<Awaited<ReturnType<typeof getGroceryAnalytics>>> }) {
  const maxMonth = Math.max(...data.months.map((m) => m.spend), 1);
  const maxStore = Math.max(...data.stores.map((s) => s.spend), 1);
  return (
    <>
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
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg"
          : "rounded-full bg-elevated px-3 py-1.5 text-xs font-medium text-muted"
      }
    >
      {children}
    </button>
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
