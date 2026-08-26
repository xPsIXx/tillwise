import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  assignItemProduct,
  listCanonicalProducts,
  searchCanonicalProducts,
} from "@/lib/grocery/server";
import type { TripItem } from "@/lib/grocery/types";

export function ProductMatchSheet({
  item,
  onClose,
  onSaved,
}: {
  item: TripItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState(item.name);
  const [custom, setCustom] = useState("");
  const catalog = useQuery({
    queryKey: ["canonical-products"],
    queryFn: () => listCanonicalProducts(),
  });
  const search = useQuery({
    queryKey: ["canonical-search", query],
    queryFn: () => searchCanonicalProducts({ data: { query } }),
    enabled: query.trim().length > 1,
  });
  const options = useMemo(() => {
    const rows = (query.trim().length > 1 ? search.data : catalog.data) ?? [];
    return rows.slice(0, 20);
  }, [catalog.data, query, search.data]);

  const assign = useMutation({
    mutationFn: (payload: { productId?: number | null; newName?: string | null }) =>
      assignItemProduct({ data: { itemId: item.id, ...payload } }),
    onSuccess: () => {
      toast.success("Matched to a product");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not match"),
  });

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-bg/55 sm:place-items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[86dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-[var(--shadow-border)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Canonical product</p>
        <h2 className="font-display text-2xl">{item.name}</h2>
        <p className="mt-1 text-sm text-muted">
          {item.productName
            ? `Now: ${item.productName}`
            : "Link this aisle/till name to one product so prices compare across shops."}
        </p>
        <Input
          className="mt-4"
          value={query}
          placeholder="Search products"
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="mt-3 divide-y divide-border">
          {options.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm"
                onClick={() => assign.mutate({ productId: p.id })}
                disabled={assign.isPending}
              >
                <span className="min-w-0 truncate">
                  {p.name}
                  {p.brand ? <span className="text-muted"> · {p.brand}</span> : null}
                </span>
                <span className="text-xs text-subtle">Use</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) assign.mutate({ newName: custom.trim() });
          }}
        >
          <Input
            value={custom}
            placeholder="New canonical name"
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button type="submit" disabled={assign.isPending || !custom.trim()}>
            Create
          </Button>
        </form>
        <Button type="button" variant="ghost" className="mt-3 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
