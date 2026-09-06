import { APP_VERSION } from "@/lib/version";
import { resolveEndpoint, loadLlmConfig } from "./llm";
import type { ScanSettings } from "./settings";
import type { LlmProvider, TripDetail } from "./types";

function stripImages(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image") || value.startsWith("data:application")) {
      return `[omitted image ${value.length} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(stripImages);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/image|thumbnail/i.test(k) && typeof v === "string") {
        out[k] = v.startsWith("data:") ? `[omitted image ${v.length} chars]` : v;
      } else {
        out[k] = stripImages(v);
      }
    }
    return out;
  }
  return value;
}

function hostOnly(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`);
    return u.host;
  } catch {
    return "(set)";
  }
}

export async function tripSnapshot(
  detail: TripDetail,
  settings: ScanSettings | null,
  extra?: { ledger?: unknown; actions?: unknown },
) {
  const { trip, items, receipts, shots } = detail;
  const lineSum = items.reduce((acc, it) => acc + (it.linePrice ?? 0), 0);
  const names = items.map((it) => it.name.trim().toLowerCase()).filter(Boolean);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  const byStatus: Record<string, number> = {};
  for (const it of items) {
    byStatus[it.matchStatus] = (byStatus[it.matchStatus] ?? 0) + 1;
  }
  const cfg = await loadLlmConfig();

  return {
    app: APP_VERSION,
    howCollateWorks:
      "Collate does not re-read photos. It loads current cart rows + receipt extracts, asks the text model to merge aisle names with till abbreviations, DELETE FROM trip_items for the trip, then inserts the merge. Photos stay on disk and are relinked by barcode/name. Wrong totals and doubled lines usually come from that merge, not from a second OCR pass.",
    settings: settings
      ? {
          read: settings.read,
          collate: settings.collate,
          autoAdd: settings.autoAdd,
          visionDetail: settings.visionDetail,
          ppocrFeel: settings.ppocrFeel,
          ppocrDetSize: settings.ppocrDetSize,
          ppocrRecSize: settings.ppocrRecSize,
        }
      : null,
    models: {
      source: cfg.source,
      localHost: hostOnly(cfg.localUrl),
      localVision: cfg.visionModel,
      localText: cfg.textModel,
      hasLocalKey: cfg.hasLocalKey,
      byokHost: hostOnly(cfg.byokUrl),
      byokVision: cfg.byokVisionModel,
      byokText: cfg.byokTextModel,
      hasByokKey: cfg.hasByokKey,
    },
    ledger: extra?.ledger ?? null,
    actions: extra?.actions ?? [],
    trip,
    math: {
      itemLineSum: Math.round(lineSum * 100) / 100,
      receiptSubtotal: trip.receiptSubtotal,
      receiptTax: trip.receiptTax,
      receiptTotal: trip.receiptTotal,
      gapVsTotal:
        trip.receiptTotal != null
          ? Math.round((lineSum - trip.receiptTotal) * 100) / 100
          : null,
      duplicateNames: dupes,
      matchCounts: byStatus,
      itemCount: items.length,
      labelShots: shots.filter((s) => s.kind === "label").length,
      receiptShots: shots.filter((s) => s.kind === "receipt").length,
      unlinkedLabelShots: shots.filter((s) => s.kind === "label" && s.itemId == null).length,
      unlinkedReceiptShots: shots.filter((s) => s.kind === "receipt" && s.captureId == null).length,
    },
    items: stripImages(
      items.map((it) => ({
        id: it.id,
        source: it.source,
        matchStatus: it.matchStatus,
        matchConfidence: it.matchConfidence,
        name: it.name,
        brand: it.brand,
        description: it.description,
        barcode: it.barcode,
        category: it.category,
        quantity: it.quantity,
        quantityUnit: it.quantityUnit,
        weightValue: it.weightValue,
        weightUnit: it.weightUnit,
        unitPrice: it.unitPrice,
        linePrice: it.linePrice,
        currency: it.currency,
        rawText: it.rawText,
        productId: it.productId,
        productName: it.productName,
      })),
    ),
    receipts: stripImages(
      receipts.map((r) => ({
        id: r.id,
        sequence: r.sequence,
        extracted: r.extracted,
      })),
    ),
    shots: stripImages(
      shots.map((s) => ({
        id: s.id,
        kind: s.kind,
        itemId: s.itemId,
        captureId: s.captureId,
        barcode: s.barcode,
        createdAt: s.createdAt,
        lastRead: s.lastRead,
      })),
    ),
  };
}

export async function askLlmAboutTrip(
  snapshot: unknown,
  provider: LlmProvider,
  scope: "trip" | "full",
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let endpoint: Awaited<ReturnType<typeof resolveEndpoint>>;
  try {
    endpoint = await resolveEndpoint(provider, "text");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Set a collate model in Settings." };
  }

  const prompt =
    scope === "full"
      ? `Write a paste-ready debug report for the Tillwise developer (they will paste this into a Grok Build chat). FULL ledger dump: every trip's rows, no photos. App diagnosis, not a review of the user's LLM host.

Cover:
1. How many trips/items/shots, total image-byte sizes if listed, any trips with total vs line-sum gaps.
2. Repeated collate problems (doubles, unmatched labels, receipt_only leftovers).
3. Catalog/memory oddities.
4. App bugs vs merge mistakes.
5. End with "Paste to Grok".

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`
      : `Write a paste-ready debug report for the Tillwise developer (they will paste this into a Grok Build chat). This is ONE open trip. App diagnosis, not a review of the user's LLM server.

Shopper complaint: after Collate, totals are wrong, a label did not match the till slip, lines look doubled, photos seemed re-scanned.

Cover:
1. Facts from the snapshot (store, item count, line sum vs printed total, unmatched/duplicate names).
2. The actions log: which buttons were tapped and whether they succeeded.
3. Each problem line by name and price. Say if it is a collate-merge bug, a till-slip extract bug, or a label extract bug.
3. App behaviour that caused it (Collate deletes cart rows and inserts the merge; photos are not OCR'd again).
4. Suggested next taps in the app.
5. Anything in the ledger/settings block that looks like an app bug.

Be long and specific. End with a section titled "Paste to Grok" that is self-contained. No JSON in the prose (the snapshot is already attached).

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

  const body: Record<string, unknown> = {
    model: endpoint.model,
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      {
        role: "system",
        content:
          "You write Tillwise debug reports the shopper can copy to the developer. Be exhaustive and concrete. Prefer the printed till total. Never invent barcodes. Do not lecture about the user's model host.",
      },
      { role: "user", content: prompt },
    ],
  };

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(endpoint.timeoutMs, 180_000)),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Model ${res.status}. ${t.slice(0, 240)}`.trim() };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "The model returned an empty reply." };
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not reach the model.",
    };
  }
}
