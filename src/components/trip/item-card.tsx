import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import type { TripItem } from "@/lib/grocery/types";
import { money, qty, weight } from "@/lib/grocery/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MATCH: Record<string, { label: string; tone: "ok" | "muted" | "warn" | "accent" }> = {
  matched: { label: "Matched", tone: "ok" },
  label_only: { label: "Label only", tone: "muted" },
  receipt_only: { label: "Till only", tone: "warn" },
  unmatched: { label: "In cart", tone: "muted" },
  processing: { label: "Reading", tone: "accent" },
};

export function ItemCard({
  item,
  currency,
  onEdit,
  onDelete,
}: {
  item: TripItem;
  currency: string;
  onEdit?: (item: TripItem) => void;
  onDelete?: (item: TripItem) => void;
}) {
  const match = MATCH[item.matchStatus] ?? MATCH.unmatched;
  const reading = item.matchStatus === "processing";
  return (
    <article className="flex gap-3 rounded-xl bg-surface p-3 shadow-[var(--shadow-border)]">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-elevated">
        {item.thumbnailData ? (
          <img
            src={item.thumbnailData}
            alt=""
            className={cn("size-full object-cover", reading && "opacity-60")}
          />
        ) : (
          <div className="grid size-full place-items-center text-xs text-subtle">
            No photo
          </div>
        )}
        {reading && (
          <div className="absolute inset-0 grid place-items-center">
            <LoaderCircle className="size-5 animate-spin text-accent" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-medium leading-tight">{item.name}</h3>
            <p className="truncate text-xs text-muted">
              {reading
                ? "Captured — filling in from the photo"
                : [item.brand, item.category].filter(Boolean).join(" · ") ||
                  item.description ||
                  "Scanned item"}
            </p>
          </div>
          <Badge tone={match.tone}>{match.label}</Badge>
        </div>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Weight" value={weight(item.weightValue, item.weightUnit)} />
          <Stat label="Qty" value={qty(item.quantity, item.quantityUnit)} />
          <Stat
            label="Price"
            value={money(item.linePrice, item.currency ?? currency)}
            strong
          />
        </dl>
        {(onEdit || onDelete) && !reading && (
          <div className="mt-2 flex justify-end gap-1">
            {onEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted"
                onClick={() => onEdit(item)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-muted"
                onClick={() => onDelete(item)}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className={cn("tabular-nums text-fg", strong && "font-medium")}>{value}</dd>
    </div>
  );
}
