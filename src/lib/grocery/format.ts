const CURRENCY_FALLBACK = "AED";

export function money(
  value: number | null | undefined,
  currency = CURRENCY_FALLBACK,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en-AE", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function weight(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value == null) return "—";
  const u = (unit ?? "").trim() || "kg";
  const digits = value >= 10 || Number.isInteger(value) ? 0 : value >= 1 ? 2 : 3;
  return `${trimNum(value, digits)} ${u}`;
}

export function qty(
  value: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (value == null) return "—";
  const u = (unit ?? "ea").trim();
  return `${trimNum(value, Number.isInteger(value) ? 0 : 2)} ${u}`;
}

export function trimNum(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toString();
}

export function tripDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function tripDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function statusLabel(status: string): string {
  switch (status) {
    case "shopping":
      return "In the aisle";
    case "receipt":
      return "Receipt";
    case "review":
      return "Review";
    case "complete":
      return "Filed";
    default:
      return status;
  }
}
