import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LabelExtraction } from "@/lib/grocery/types";

export type ShelfDraft = {
  image: string;
  data: LabelExtraction;
  store: string;
};

export function ShelfSheet({
  draft,
  canSend,
  busy,
  onCancel,
  onSave,
}: {
  draft: ShelfDraft;
  canSend: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: {
    name: string;
    barcode: string;
    price: string;
    store: string;
    sendOff: boolean;
  }) => void;
}) {
  const [name, setName] = useState(draft.data.name);
  const [barcode, setBarcode] = useState(draft.data.barcode ?? "");
  const [price, setPrice] = useState(
    String(draft.data.linePrice ?? draft.data.unitPrice ?? ""),
  );
  const [store, setStore] = useState(draft.store);
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-bg/50 p-4 sm:place-items-center">
      <form
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, barcode, price, store, sendOff: canSend });
        }}
      >
        <h3 className="font-display text-2xl">Shelf price</h3>
        <p className="mt-1 text-sm text-muted">
          Not a trip. Saved to your prices for this shop. Open Prices gets the photo if you send.
          Shop name is almost never on the sticker — use the store you picked in Settings.
        </p>
        <img src={draft.image} alt="" className="mt-4 max-h-56 w-full rounded-xl object-contain bg-elevated" />
        <label className="mt-4 block text-xs text-muted">
          Name
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="mt-3 block text-xs text-muted">
          Barcode
          <Input className="mt-1" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">
            Price
            <Input
              className="mt-1"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
          <label className="text-xs text-muted">
            Shop
            <Input className="mt-1" value={store} onChange={(e) => setStore(e.target.value)} required />
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : canSend ? "Save and send to Open Prices" : "Save to my prices"}
          </Button>
          {canSend ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onSave({ name, barcode, price, store, sendOff: false })}
            >
              Save only
            </Button>
          ) : (
            <p className="text-xs text-muted">
              To send to Open Prices, add the account and OSM shop in Settings.
            </p>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Discard
          </Button>
        </div>
      </form>
    </div>
  );
}
