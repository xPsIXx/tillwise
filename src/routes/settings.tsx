import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPpocr, ppocrReady } from "@/lib/grocery/ppocr";
import {
  PPOCR_FEEL,
  PPOCR_SIZES,
  READ_OPTIONS,
  loadScanSettings,
  saveScanSettings,
  type ScanSettings,
  type VisionDetail,
} from "@/lib/grocery/settings";
import { getLlmConfig, inspectLedger, listLlmModels, listTrips, repairLedger, saveLlmConfig, troubleshootTrip, exportLedger, getOffConfig, saveOffConfig, searchOffStores, testOffLogin } from "@/lib/grocery/server";
import { statusLabel, tripDate } from "@/lib/grocery/format";
import { type EngineProgress } from "@/lib/grocery/tfjs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<ScanSettings>(() => loadScanSettings());
  const [url, setUrl] = useState("");
  const [vision, setVision] = useState("");
  const [text, setText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [byokUrl, setByokUrl] = useState("");
  const [byokVision, setByokVision] = useState("");
  const [byokText, setByokText] = useState("");
  const [byokKey, setByokKey] = useState("");
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [byokModels, setByokModels] = useState<string[]>([]);
  const [localModelErr, setLocalModelErr] = useState<string | null>(null);
  const [byokModelErr, setByokModelErr] = useState<string | null>(null);
  const [engine, setEngine] = useState<EngineProgress | null>(null);

  const cfgQuery = useQuery({
    queryKey: ["llm-config"],
    queryFn: () => getLlmConfig(),
  });
  const cfg = cfgQuery.data;
  const localLocked = Boolean(cfg?.localLocked);
  const byokLocked = Boolean(cfg?.byokLocked);

  useEffect(() => {
    if (!cfg) return;
    setUrl(cfg.localUrl ?? "");
    setVision(cfg.visionModel ?? "");
    setText(cfg.textModel ?? "");
    setByokUrl(cfg.byokUrl ?? "");
    setByokVision(cfg.byokVisionModel ?? "");
    setByokText(cfg.byokTextModel ?? "");
    if (settings.read === "local" && !cfg.localAvailable) {
      patch({ read: "ppocr" });
    } else if (
      (settings.read === "byok" || settings.read === "grok") &&
      !cfg.byokAvailable
    ) {
      patch({ read: "ppocr" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (settings.read === "ppocr" && !ppocrReady()) {
        const ok = await loadPpocr((p) => {
          if (!cancelled) setEngine(p);
        });
        if (cancelled) return;
        if (!ok) {
          setEngine((prev) =>
            prev?.error
              ? prev
              : { label: "PP-OCRv6 failed to load", pct: 0, error: true },
          );
          return;
        }
      }
      if (!cancelled && ppocrReady()) {
        window.setTimeout(() => {
          if (!cancelled) setEngine(null);
        }, 800);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [settings.read, settings.ppocrDetSize]);

  function patch(next: Partial<ScanSettings>) {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      saveScanSettings(merged);
      return merged;
    });
  }

  async function loadModels(which: "local" | "byok", opts?: { quiet?: boolean }) {
    const draft =
      which === "local"
        ? { baseUrl: url, apiKey: apiKey.trim() || undefined }
        : { baseUrl: byokUrl, apiKey: byokKey.trim() || undefined };
    if (which === "local") setLocalModelErr(null);
    else setByokModelErr(null);
    try {
      const res = await listLlmModels({
        data: { which, baseUrl: draft.baseUrl, apiKey: draft.apiKey },
      });
      if (which === "local") {
        setLocalModels(res.models);
        setLocalModelErr(res.error);
      } else {
        setByokModels(res.models);
        setByokModelErr(res.error);
      }
      if (!opts?.quiet) {
        if (res.models.length) toast.success(`${res.models.length} models on that endpoint`);
        else if (res.error) toast.error(res.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not list models";
      if (which === "local") setLocalModelErr(message);
      else setByokModelErr(message);
      toast.error(message);
    }
  }

  useEffect(() => {
    if (!cfg) return;
    if (cfg.localUrl) void loadModels("local", { quiet: true });
    if (cfg.byokUrl && cfg.hasByokKey) void loadModels("byok", { quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.localUrl, cfg?.byokUrl, cfg?.hasByokKey, cfg?.hasLocalKey]);

  const save = useMutation({
    mutationFn: () =>
      saveLlmConfig({
        data: {
          localUrl: url,
          visionModel: vision,
          textModel: text,
          apiKey: apiKey.trim() ? apiKey : undefined,
          byokUrl,
          byokVisionModel: byokVision,
          byokTextModel: byokText,
          byokApiKey: byokKey.trim() ? byokKey : undefined,
        },
      }),
    onSuccess: (next) => {
      toast.success("Endpoints saved");
      setApiKey("");
      setByokKey("");
      void qc.setQueryData(["llm-config"], next);
      if (next.localUrl) void loadModels("local", { quiet: true });
      if (next.byokUrl && next.hasByokKey) void loadModels("byok", { quiet: true });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save"),
  });

  const showLlmForm = false;
  const showByokForm = true;
  const showVisionDetail = showLlmForm || showByokForm;

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Scanner</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        Detect on the phone, then snap. Labels use PP-OCR or BYOK. Collate, receipts, and debug
        use the BYOK text model.
      </p>

      {engine && (
        <div className="mt-5 rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
          <p className={engine.error ? "text-sm text-red-600" : "text-sm"}>{engine.label}</p>
          {!engine.error && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${engine.pct}%` }}
              />
            </div>
          )}
          {engine.error && (
            <Button
              type="button"
              className="mt-3"
              onClick={() => {
                setEngine({ label: "Retrying PP-OCRv6…", pct: 4 });
                void loadPpocr((p) => setEngine(p)).then((ok) => {
                  if (ok) {
                    setEngine({ label: "PP-OCRv6 ready", pct: 100 });
                    window.setTimeout(() => setEngine(null), 800);
                  }
                });
              }}
            >
              Try again
            </Button>
          )}
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-2xl">How to read it</h2>
        <p className="mt-1 text-sm text-muted">
          Labels use this reader. Till tape, collate, and debug always use the BYOK models below.
        </p>
        <div className="mt-4 grid gap-2">
          {READ_OPTIONS.map((opt) => (
            <Choice
              key={opt.id}
              title={opt.title}
              body={
                opt.id === "byok" && cfg && !cfg.byokAvailable
                  ? `${opt.body} Add an endpoint, vision model, and API key below.`
                  : opt.body
              }
              selected={settings.read === opt.id}
              onSelect={() => patch({ read: opt.id })}
            />
          ))}
        </div>
      </section>

      {showLlmForm && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Local models</h2>
          <p className="mt-1 text-sm text-muted">
            {localLocked
              ? "Set on the server as environment variables — they win over this form."
              : "Your machine or LAN. OpenAI-compatible /v1/chat/completions. Saved in this app if the environment is empty."}
          </p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!localLocked || !byokLocked) save.mutate();
            }}
          >
            <label className="block text-xs font-medium text-muted">
              LLM_BASE_URL
              <Input
                className="mt-1"
                value={url}
                disabled={localLocked}
                placeholder="http://192.168.1.2:8088"
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
            </label>
            {!localLocked && (
              <label className="block text-xs font-medium text-muted">
                API key {cfg?.hasLocalKey ? "(saved)" : "(optional)"}
                <Input
                  className="mt-1"
                  type="password"
                  value={apiKey}
                  placeholder={cfg?.hasLocalKey ? "Leave blank to keep" : ""}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!url.trim()}
                onClick={() => void loadModels("local")}
              >
                List models
              </Button>
              {localModelErr ? <span className="text-xs text-red-600">{localModelErr}</span> : null}
            </div>
            <ModelPicker
              label="Vision model"
              value={vision}
              models={localModels}
              disabled={localLocked}
              placeholder="Qwen3-VL-8B"
              onChange={setVision}
            />
            <ModelPicker
              label="Text model"
              value={text}
              models={localModels}
              disabled={localLocked}
              placeholder="Qwen3.5-9B"
              onChange={setText}
            />
            {!localLocked && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save local models"}
              </Button>
            )}
          </form>
        </section>
      )}

      {showByokForm && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Bring your own key</h2>
          <p className="mt-1 text-sm text-muted">
            Any OpenAI-compatible chat API: OpenAI, OpenRouter, Together, Groq, xAI, Azure,
            a second home box. Base URL only — we append <code>/v1/chat/completions</code>.
          </p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!byokLocked) save.mutate();
            }}
          >
            <label className="block text-xs font-medium text-muted">
              Endpoint
              <Input
                className="mt-1"
                value={byokUrl}
                disabled={byokLocked}
                placeholder="https://api.openai.com"
                onChange={(e) => setByokUrl(e.target.value)}
                autoComplete="off"
              />
            </label>
            {!byokLocked && (
              <label className="block text-xs font-medium text-muted">
                API key {cfg?.hasByokKey ? "(saved)" : ""}
                <Input
                  className="mt-1"
                  type="password"
                  value={byokKey}
                  placeholder={cfg?.hasByokKey ? "Leave blank to keep" : "sk-…"}
                  onChange={(e) => setByokKey(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!byokUrl.trim() || (!byokKey.trim() && !cfg?.hasByokKey)}
                onClick={() => void loadModels("byok")}
              >
                List models
              </Button>
              {byokModelErr ? <span className="text-xs text-red-600">{byokModelErr}</span> : null}
            </div>
            <ModelPicker
              label="Vision model"
              value={byokVision}
              models={byokModels}
              disabled={byokLocked}
              placeholder="gpt-4o-mini"
              onChange={setByokVision}
            />
            <ModelPicker
              label="Text / collate model"
              value={byokText}
              models={byokModels}
              disabled={byokLocked}
              placeholder="gpt-4o-mini"
              onChange={setByokText}
            />
            {!byokLocked && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save BYOK"}
              </Button>
            )}
          </form>
          <Button asChild variant="secondary" className="mt-4">
            <Link to="/prompts">Edit model prompts</Link>
          </Button>
        </section>
      )}

      {showVisionDetail && (
        <section className="mt-8">
          <h3 className="text-sm font-medium">Photo detail</h3>
          <p className="mt-1 text-xs text-muted">
            High sends a sharper till slip (more tokens). Low is enough for large scale stickers.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["low", "high"] as VisionDetail[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => patch({ visionDetail: d })}
                className={cn(
                  "h-11 rounded-xl text-sm font-medium capitalize",
                  settings.visionDetail === d ? "bg-fg text-bg" : "bg-elevated text-muted",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="mt-10">
        <summary className="cursor-pointer font-display text-2xl">Reading options</summary>
        <p className="mt-2 text-sm text-muted">
          PP-OCR size and feel, and whether a snap goes straight to the cart.
        </p>
        <h3 className="mt-6 text-sm font-medium">PP-OCR model size</h3>
        <div className="mt-3 grid gap-2">
          {PPOCR_SIZES.map((opt) => (
            <Choice
              key={`det-${opt.id}`}
              title={opt.title}
              body={opt.body}
              selected={settings.ppocrDetSize === opt.id}
              onSelect={() => patch({ ppocrDetSize: opt.id, ppocrRecSize: opt.id })}
            />
          ))}
        </div>
        <h3 className="mt-6 text-sm font-medium">PP-OCR sensitivity</h3>
        <div className="mt-3 grid gap-2">
          {PPOCR_FEEL.map((opt) => (
            <Choice
              key={opt.id}
              title={opt.title}
              body={opt.body}
              selected={settings.ppocrFeel === opt.id}
              onSelect={() => patch({ ppocrFeel: opt.id })}
            />
          ))}
        </div>
        <h3 className="mt-6 text-sm font-medium">After the snap</h3>
        <div className="mt-3 grid gap-2">
          <Choice
            title="Add to cart, fill in later"
            body="Default. The photo joins the cart as “Reading…”. The reader patches the row when it finishes."
            selected={settings.autoAdd}
            onSelect={() => patch({ autoAdd: true })}
          />
          <Choice
            title="Hold for a look"
            body="Only for PP-OCR. You confirm the extract before it joins the cart. BYOK still skips this sheet."
            selected={!settings.autoAdd}
            onSelect={() => patch({ autoAdd: false })}
          />
        </div>
        <dl className="mt-6 space-y-3 text-sm">
          <Row
            k="PP-OCRv6"
            v="On this phone. Enabling it downloads det + rec from Hugging Face (~30 MB), then caches them."
          />
          <Row
            k="BYOK"
            v="Your key, your endpoint. OpenAI-compatible /v1/chat/completions. Saved here or BYOK_BASE_URL / BYOK_API_KEY / BYOK_VISION_MODEL / BYOK_TEXT_MODEL."
          />
        </dl>
      </details>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Debug</h2>
        <Toggle
          label="Show sample stickers"
          hint="Puts the “Try a sample” strip back on the scan page. Off by default so the receipt viewfinder can stay tall."
          checked={settings.debugSamples}
          onChange={(debugSamples) => patch({ debugSamples })}
        />
        <DebugReports />
      </section>

      <ExportPanel />
      <OpenFoodPanel />
      <LedgerPanel />
    </main>
  );
}

function DebugReports() {
  const [tripId, setTripId] = useState<number | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const copyBox = useRef<HTMLTextAreaElement>(null);
  const tripsQuery = useQuery({
    queryKey: ["trips"],
    queryFn: () => listTrips(),
  });
  const trips = tripsQuery.data ?? [];

  useEffect(() => {
    if (tripId != null) return;
    const open = trips.find((t) => t.status === "shopping") ?? trips[0];
    if (open) setTripId(open.id);
  }, [trips, tripId]);

  const help = useMutation({
    mutationFn: (scope: "trip" | "full") => {
      if (tripId == null) throw new Error("No trip to debug");
      const settings = loadScanSettings();
      return troubleshootTrip({
        data: { tripId, scope, provider: "byok", settings },
      });
    },
    onSuccess: (res) => {
      setDiagnosis(res.diagnosis);
      setReport(res.report);
      toast.success("The write-up is below. Copy it and paste it into the Tillwise chat.");
      window.setTimeout(() => {
        document.getElementById("debug-opinion")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not ask the model"),
  });

  return (
    <div className="mt-6 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <p className="text-sm text-muted">
        Same page, no extra debug screen. Tap a button, wait (up to 10 minutes), then the model’s
        write-up appears in the box below. Copy that text and paste it into this Grok chat so I
        can see what went wrong. The raw JSON is optional.
      </p>
      {trips.length > 0 ? (
        <label className="mt-4 block text-sm">
          <span className="text-muted">Trip for “this trip”</span>
          <select
            className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2"
            value={tripId ?? ""}
            onChange={(e) => setTripId(Number(e.target.value))}
          >
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.storeName || "Untitled"} · {statusLabel(t.status)} · {tripDate(t.startedAt)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-4 text-sm text-muted">No trips yet.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={help.isPending || tripId == null}
          onClick={() => help.mutate("trip")}
        >
          {help.isPending && help.variables !== "full" ? "Waiting (up to 10 min)…" : "Debug this trip"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={help.isPending || tripId == null}
          onClick={() => help.mutate("full")}
        >
          {help.isPending && help.variables === "full" ? "Waiting (up to 10 min)…" : "Full debug"}
        </Button>
      </div>
      {(report || diagnosis) && (
        <div id="debug-opinion" className="mt-5">
          <h3 className="font-display text-xl">Model write-up</h3>
          <p className="mt-1 text-sm text-muted">
            This is the model’s opinion. Copy it, then paste it into the Tillwise Grok chat.
          </p>
          <textarea
            id="debug-report"
            ref={copyBox}
            readOnly
            className="mt-3 h-80 w-full rounded-md border border-border bg-bg p-3 text-sm leading-relaxed"
            value={diagnosis ?? report ?? ""}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                const text = diagnosis ?? report ?? "";
                const box = copyBox.current;
                if (box) {
                  box.focus();
                  box.select();
                }
                void navigator.clipboard.writeText(text).then(
                  () => toast.success("Copied — paste it into the Tillwise chat"),
                  () => toast.error("Copy failed — select the text in the box and copy it"),
                );
              }}
            >
              Copy write-up
            </Button>
            {report && report !== diagnosis ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(report).then(
                    () => toast.success("Copied write-up plus snapshot JSON"),
                    () => toast.error("Copy failed"),
                  );
                }}
              >
                Copy with snapshot
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDiagnosis(null);
                setReport(null);
              }}
            >
              Dismiss
            </Button>
          </div>
          {report && report !== diagnosis ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted">Raw snapshot JSON</summary>
              <textarea
                readOnly
                className="mt-2 h-40 w-full rounded-md border border-border bg-bg p-3 font-mono text-xs"
                value={report}
              />
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round((n / 1024) * 10) / 10} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function ExportPanel() {
  const dump = useMutation({
    mutationFn: () => exportLedger(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not export"),
  });

  function asJson() {
    dump.mutate(undefined, {
      onSuccess: (data) => {
        downloadText(
          `tillwise-${data.exportedAt.slice(0, 10)}.json`,
          JSON.stringify(data, null, 2),
          "application/json",
        );
        toast.success("JSON downloaded — no photos");
      },
    });
  }

  function asCsv() {
    dump.mutate(undefined, {
      onSuccess: (data) => {
        const header = [
          "trip_id",
          "date",
          "store",
          "status",
          "name",
          "brand",
          "barcode",
          "qty",
          "weight",
          "weight_unit",
          "unit_price",
          "line_price",
          "match",
          "till_name",
          "currency",
        ];
        const rows = [header.join(",")];
        for (const trip of data.trips) {
          for (const item of trip.items) {
            rows.push(
              [
                trip.id,
                csvCell(trip.startedAt),
                csvCell(trip.storeName),
                csvCell(trip.status),
                csvCell(item.name),
                csvCell(item.brand),
                csvCell(item.barcode),
                item.quantity ?? "",
                item.weightValue ?? "",
                csvCell(item.weightUnit),
                item.unitPrice ?? "",
                item.linePrice ?? "",
                csvCell(item.matchStatus),
                csvCell(item.tillName),
                csvCell(trip.currency),
              ].join(","),
            );
          }
        }
        downloadText(`tillwise-${data.exportedAt.slice(0, 10)}.csv`, rows.join("\n"), "text/csv");
        toast.success("CSV downloaded — no photos");
      },
    });
  }

  return (
    <section className="mt-10 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-2xl">Export</h2>
      <p className="mt-1 text-sm text-muted">
        Trips and lines only. Photos stay on the share. Keep a copy off the server.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={asJson} disabled={dump.isPending}>
          {dump.isPending ? "Preparing…" : "Download JSON"}
        </Button>
        <Button type="button" variant="secondary" onClick={asCsv} disabled={dump.isPending}>
          Download CSV
        </Button>
      </div>
    </section>
  );
}

function OpenFoodPanel() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["off-config"], queryFn: () => getOffConfig() });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [storeQ, setStoreQ] = useState("");
  useEffect(() => {
    if (cfg.data?.username) setUsername(cfg.data.username);
  }, [cfg.data?.username]);
  const save = useMutation({
    mutationFn: () =>
      saveOffConfig({
        data: { username, password: password || undefined },
      }),
    onSuccess: () => {
      toast.success("Open Food Facts account saved");
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["off-config"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save"),
  });
  const test = useMutation({
    mutationFn: () => testOffLogin(),
    onSuccess: (res) => toast.success(`Signed in as ${res.username}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Login failed"),
  });
  const stores = useQuery({
    queryKey: ["off-stores", storeQ],
    queryFn: () => searchOffStores({ data: storeQ }),
    enabled: storeQ.trim().length >= 3,
  });
  const pick = useMutation({
    mutationFn: (hit: { osmId: number; osmType: "NODE" | "WAY" | "RELATION"; name: string }) =>
      saveOffConfig({ data: { osmId: hit.osmId, osmType: hit.osmType, osmName: hit.name } }),
    onSuccess: (res) => {
      toast.success(`Shop set to ${res.osmName?.split(",")[0]}`);
      void qc.invalidateQueries({ queryKey: ["off-config"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save shop"),
  });
  return (
    <section className="mt-10 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-2xl">Open Food Facts</h2>
      <p className="mt-1 text-sm text-muted">
        Same account as{" "}
        <a className="underline-offset-2 hover:underline" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
          openfoodfacts.org
        </a>
        . Username, not email. Trip → More sends the till photo as proof of what you paid, plus each line (name, barcode if any, AED). Card/loyalty boxes from the till read are blacked out first (footer fallback if none). A check on the photo means it was already sent. Shelf labels are not sent. Pick the OSM shop so the receipt is tied to that store.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted">
          Username
          <Input className="mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </label>
        <label className="text-xs text-muted">
          Password {cfg.data?.hasPassword ? "(saved)" : ""}
          <Input
            className="mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={cfg.data?.hasPassword ? "Leave blank to keep" : ""}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save account"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? "Checking…" : "Test login"}
        </Button>
      </div>
      <label className="mt-5 block text-xs text-muted">
        Shop on the map (UAE)
        <Input
          className="mt-1"
          value={storeQ}
          onChange={(e) => setStoreQ(e.target.value)}
          placeholder="Lulu Al Wahda Abu Dhabi"
        />
      </label>
      {cfg.data?.osmName ? (
        <p className="mt-2 text-sm">Using {cfg.data.osmName.split(",")[0]}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">No shop picked yet.</p>
      )}
      {(stores.data ?? []).length > 0 ? (
        <ul className="mt-2 space-y-1">
          {(stores.data ?? []).map((hit) => (
            <li key={`${hit.osmType}-${hit.osmId}`}>
              <button
                type="button"
                className="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-elevated"
                onClick={() => pick.mutate(hit)}
              >
                {hit.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LedgerPanel() {
  const [waitingRestart, setWaitingRestart] = useState(false);
  const inspect = useQuery({
    queryKey: ["ledger"],
    queryFn: () => inspectLedger(),
  });
  const repair = useMutation({
    mutationFn: () => repairLedger(),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.steps.at(-1) ?? "Could not repair");
        void inspect.refetch();
        return;
      }
      if (res.restarting) {
        toast.success(
          res.trips != null
            ? `Repaired. ${res.trips} trip(s) readable. Restarting…`
            : "Repaired. Restarting…",
        );
        setWaitingRestart(true);
        const started = Date.now();
        const tick = () => {
          void fetch("/", { cache: "no-store" })
            .then((r) => {
              if (r.ok && Date.now() - started > 2500) {
                window.location.reload();
                return;
              }
              if (Date.now() - started > 60_000) {
                toast.error("Restart is taking too long. Start Tillwise from Unraid.");
                setWaitingRestart(false);
                return;
              }
              window.setTimeout(tick, 1000);
            })
            .catch(() => {
              if (Date.now() - started > 60_000) {
                toast.error("Restart is taking too long. Start Tillwise from Unraid.");
                setWaitingRestart(false);
                return;
              }
              window.setTimeout(tick, 1000);
            });
        };
        window.setTimeout(tick, 1500);
        return;
      }
      toast.success(
        res.trips != null ? `Ledger opens. ${res.trips} trip(s) on disk.` : "Ledger already opens.",
      );
      void inspect.refetch();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not repair"),
  });
  const data = inspect.data;
  const busy = repair.isPending || waitingRestart;

  return (
    <section className="mt-8 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
      <h2 className="font-display text-2xl">Ledger</h2>
      <p className="mt-1 text-sm text-muted">
        One button. It copies the folder first and never deletes it. It then tries to open trips in
        a fresh process. If the log is torn it resets that log and restarts the app. postmaster.pid
        coming back after a start is normal.
      </p>
      {inspect.isLoading ? (
        <p className="mt-4 text-sm text-muted">Looking at the ledger folder…</p>
      ) : inspect.isError ? (
        <p className="mt-4 text-sm text-red-600">
          {inspect.error instanceof Error ? inspect.error.message : "Could not inspect"}
        </p>
      ) : data ? (
        <dl className="mt-4 space-y-2 text-sm">
          <Row k="Folder" v={data.path} />
          <Row
            k="PG_VERSION"
            v={
              data.pgVersion
                ? `${data.pgVersion} · ${formatBytes(data.pgVersionBytes ?? 0)}`
                : "Missing"
            }
          />
          <Row k="Size" v={`${data.fileCount} files · ${formatBytes(data.bytes)}`} />
          {data.backups.length > 0 ? (
            <Row k="Copies kept" v={data.backups.slice(0, 3).join(", ")} />
          ) : null}
        </dl>
      ) : null}
      {repair.data?.steps.map((note) => (
        <p key={note} className="mt-3 text-sm text-muted">
          {note}
        </p>
      ))}
      <Button
        type="button"
        className="mt-5"
        disabled={busy || !data?.pgVersion}
        onClick={() => repair.mutate()}
      >
        {busy ? "Repairing…" : "Repair ledger"}
      </Button>
    </section>
  );
}

function ModelPicker({
  label,
  value,
  models,
  disabled,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  models: string[];
  disabled?: boolean;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  const custom = value && !models.includes(value);
  return (
    <label className="block text-xs font-medium text-muted">
      {label}
      {models.length > 0 ? (
        <select
          className="mt-1 h-11 w-full rounded-md bg-elevated px-3 text-sm text-fg"
          value={custom ? "__custom__" : value}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === "__custom__") return;
            onChange(e.target.value);
          }}
        >
          <option value="">Choose a model…</option>
          {models.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
          {custom ? <option value="__custom__">{value}</option> : null}
        </select>
      ) : (
        <Input
          className="mt-1"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
      {models.length > 0 ? (
        <Input
          className="mt-2"
          value={value}
          disabled={disabled}
          placeholder="Or type a model id"
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      ) : (
        <span className="mt-1 block text-[11px] text-subtle">
          Save the endpoint and key, then tap List models for a dropdown.
        </span>
      )}
    </label>
  );
}

function Choice({
  title,
  body,
  selected,
  onSelect,
}: {
  title: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-xl px-4 py-3 text-left shadow-[var(--shadow-border)]",
        selected ? "bg-elevated" : "bg-surface",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-medium">{title}</span>
        <span
          className={cn("mt-1 size-3 shrink-0 rounded-full", selected ? "bg-accent" : "bg-border")}
        />
      </span>
      <span className="mt-1 block text-sm text-muted">{body}</span>
    </button>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl bg-surface px-4 py-3 text-left shadow-[var(--shadow-border)]"
    >
      <span>
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-muted">{hint}</span>
      </span>
      <span className={cn("relative h-6 w-11 shrink-0 rounded-full", checked ? "bg-accent" : "bg-elevated")}>
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-fg transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-subtle">{k}</dt>
      <dd className="mt-1 text-muted">{v}</dd>
    </div>
  );
}
