import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deviceTextAvailable } from "@/lib/grocery/parse-local";
import { loadPpocr, ppocrReady } from "@/lib/grocery/ppocr";
import {
  COLLATE_OPTIONS,
  DETECT_OPTIONS,
  PPOCR_FEEL,
  PPOCR_SIZES,
  READ_OPTIONS,
  loadScanSettings,
  saveScanSettings,
  type ScanSettings,
  type VisionDetail,
} from "@/lib/grocery/settings";
import { getLlmConfig, saveLlmConfig } from "@/lib/grocery/server";
import { loadTfjs, tfReady, type EngineProgress } from "@/lib/grocery/tfjs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const qc = useQueryClient();
  const [settings, setSettings] = useState<ScanSettings>(() => loadScanSettings());
  const [url, setUrl] = useState("");
  const [vision, setVision] = useState("");
  const [text, setText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [engine, setEngine] = useState<EngineProgress | null>(null);
  const textOk = useMemo(() => deviceTextAvailable(), []);

  const cfgQuery = useQuery({
    queryKey: ["llm-config"],
    queryFn: () => getLlmConfig(),
  });
  const cfg = cfgQuery.data;
  const envLocked = cfg?.source === "env";

  useEffect(() => {
    if (!cfg) return;
    setUrl(cfg.localUrl ?? "");
    setVision(cfg.visionModel ?? "");
    setText(cfg.textModel ?? "");
    if (settings.read === "local" && !cfg.localAvailable) {
      patch({ read: "ppocr" });
    } else if (settings.read === "grok" && !cfg.grokAvailable) {
      patch({ read: "ppocr" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (settings.detect === "tensorflow" && !tfReady()) {
        const ok = await loadTfjs((p) => {
          if (!cancelled) setEngine(p);
        });
        if (cancelled) return;
        if (!ok) {
          setEngine({ label: "TensorFlow.js failed to load", pct: 0, error: true });
          return;
        }
      }
      if ((settings.detect === "ppocr" || settings.read === "ppocr") && !ppocrReady()) {
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
      if (!cancelled && (tfReady() || ppocrReady())) {
        window.setTimeout(() => {
          if (!cancelled) setEngine(null);
        }, 800);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [settings.detect, settings.read, settings.ppocrDetSize, settings.ppocrRecSize]);

  function patch(next: Partial<ScanSettings>) {
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      saveScanSettings(merged);
      return merged;
    });
  }

  const save = useMutation({
    mutationFn: () =>
      saveLlmConfig({
        data: {
          localUrl: url,
          visionModel: vision,
          textModel: text,
          apiKey: apiKey.trim() ? apiKey : undefined,
        },
      }),
    onSuccess: (next) => {
      toast.success("Local model saved");
      setApiKey("");
      void qc.setQueryData(["llm-config"], next);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save"),
  });

  const showLlmForm = settings.read === "local" || settings.collate === "local";
  const showGrokDetail = settings.read === "grok" || settings.collate === "grok";

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Scanner</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        Detect on the phone, then snap. Reading and collation use the engine you pick — your
        local models first, Grok last.
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
        <h2 className="font-display text-2xl">When to snap</h2>
        <p className="mt-1 text-sm text-muted">
          Runs in the browser. Nothing is uploaded until a photo is taken.
        </p>
        <div className="mt-4 grid gap-2">
          {DETECT_OPTIONS.map((opt) => (
            <Choice
              key={opt.id}
              title={opt.title}
              body={opt.body}
              selected={settings.detect === opt.id}
              onSelect={() =>
                patch({
                  detect: opt.id,
                  autoCapture: opt.id === "off" ? false : settings.autoCapture,
                })
              }
            />
          ))}
        </div>
      </section>

      {settings.detect !== "off" && (
        <section className="mt-8">
          <Toggle
            label="Auto-capture"
            hint="Fire the shutter when the detector stays locked."
            checked={settings.autoCapture}
            onChange={(autoCapture) => patch({ autoCapture })}
          />
          {settings.detect !== "ppocr" && (
            <label className="mt-4 block">
              <span className="text-sm font-medium">Lock threshold</span>
              <span className="mt-0.5 block text-xs text-muted">
                Higher = pickier. Current {Math.round(settings.confidence * 100)}%.
              </span>
              <input
                type="range"
                min={10}
                max={85}
                value={Math.round(settings.confidence * 100)}
                onChange={(e) => patch({ confidence: Number(e.target.value) / 100 })}
                className="mt-3 w-full accent-accent"
              />
            </label>
          )}
        </section>
      )}

      {(settings.detect === "ppocr" || settings.read === "ppocr") && (
        <section className="mt-8">
          <h2 className="font-display text-2xl">PP-OCR model sizes</h2>
          <p className="mt-1 text-sm text-muted">
            Detection finds the sticker. Recognition reads the letters. Tiny is for live
            detect; small or medium for the snap.
          </p>
          <h3 className="mt-4 text-sm font-medium">Detection model</h3>
          <div className="mt-2 grid gap-2">
            {PPOCR_SIZES.map((opt) => (
              <Choice
                key={`det-${opt.id}`}
                title={opt.title}
                body={opt.body}
                selected={settings.ppocrDetSize === opt.id}
                onSelect={() => patch({ ppocrDetSize: opt.id })}
              />
            ))}
          </div>
          <h3 className="mt-5 text-sm font-medium">Recognition model</h3>
          <div className="mt-2 grid gap-2">
            {PPOCR_SIZES.map((opt) => (
              <Choice
                key={`rec-${opt.id}`}
                title={opt.title}
                body={opt.body}
                selected={settings.ppocrRecSize === opt.id}
                onSelect={() => patch({ ppocrRecSize: opt.id })}
              />
            ))}
          </div>
        </section>
      )}

      {(settings.detect === "ppocr" || settings.read === "ppocr") && (
        <section className="mt-8">
          <h2 className="font-display text-2xl">PP-OCR sensitivity</h2>
          <p className="mt-1 text-sm text-muted">
            Loose keeps small produce-sticker text. Strict only locks on sharp type in the aim box.
          </p>
          <div className="mt-4 grid gap-2">
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
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-2xl">How to read it</h2>
        <p className="mt-1 text-sm text-muted">
          Labels use this reader. Till tape always needs a vision LLM (local or Grok) — PP-OCR
          is a label engine, not a receipt layout model.
        </p>
        <div className="mt-4 grid gap-2">
          {READ_OPTIONS.map((opt) => (
            <Choice
              key={opt.id}
              title={opt.title}
              body={
                opt.id === "device" && !textOk
                  ? `${opt.body} This browser has no Text Detector — barcode + regex only.`
                  : opt.id === "local" && cfg && !cfg.localAvailable
                    ? `${opt.body} Not configured yet — set LLM_BASE_URL and VISION_MODEL below.`
                    : opt.id === "grok" && cfg && !cfg.grokAvailable
                      ? `${opt.body} XAI_API_KEY is not set on this server.`
                      : opt.body
              }
              selected={settings.read === opt.id}
              onSelect={() => patch({ read: opt.id })}
            />
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Collation</h2>
        <p className="mt-1 text-sm text-muted">
          After the trip, this model groups aisle names with till abbreviations.
        </p>
        <div className="mt-4 grid gap-2">
          {COLLATE_OPTIONS.map((opt) => (
            <Choice
              key={opt.id}
              title={opt.title}
              body={
                opt.id === "local" && cfg && !cfg.textModel && !cfg.visionModel
                  ? `${opt.body} Set TEXT_MODEL (falls back to VISION_MODEL).`
                  : opt.body
              }
              selected={settings.collate === opt.id}
              onSelect={() => patch({ collate: opt.id })}
            />
          ))}
        </div>
      </section>

      {showLlmForm && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Local models</h2>
          <p className="mt-1 text-sm text-muted">
            {envLocked
              ? "Set on the server as environment variables — they win over this form."
              : "Saved here if the environment is empty. Same names as yesterday: LLM_BASE_URL, VISION_MODEL, TEXT_MODEL."}
          </p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!envLocked) save.mutate();
            }}
          >
            <label className="block text-xs font-medium text-muted">
              LLM_BASE_URL
              <Input
                className="mt-1"
                value={url}
                disabled={envLocked}
                placeholder="http://192.168.1.2:8088"
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              VISION_MODEL
              <Input
                className="mt-1"
                value={vision}
                disabled={envLocked}
                placeholder="Qwen3-VL-8B"
                onChange={(e) => setVision(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-xs font-medium text-muted">
              TEXT_MODEL
              <Input
                className="mt-1"
                value={text}
                disabled={envLocked}
                placeholder="Qwen3.5-9B"
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
              />
            </label>
            {!envLocked && (
              <label className="block text-xs font-medium text-muted">
                LLM_API_KEY {cfg?.hasLocalKey ? "(saved)" : "(optional)"}
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
            {!envLocked && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save local models"}
              </Button>
            )}
          </form>
        </section>
      )}

      {showGrokDetail && (
        <section className="mt-8">
          <h3 className="text-sm font-medium">Grok photo detail</h3>
          <p className="mt-1 text-xs text-muted">
            High is slower and spends more. Low is enough for large scale stickers.
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

      <section className="mt-10">
        <h2 className="font-display text-2xl">After the snap</h2>
        <div className="mt-4 grid gap-2">
          <Choice
            title="Add to cart, fill in later"
            body="Default. The photo joins the cart as “Reading…”. PP-OCR, local vision, and Grok all keep working in the background and patch the row when they finish. Local vision and Grok never show a confirm sheet."
            selected={settings.autoAdd}
            onSelect={() => patch({ autoAdd: true })}
          />
          <Choice
            title="Hold for a look"
            body="Only for on-device readers (PP-OCR / browser text). You confirm the extract before it joins the cart. Local vision and Grok still skip this sheet."
            selected={!settings.autoAdd}
            onSelect={() => patch({ autoAdd: false })}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">Debug</h2>
        <Toggle
          label="Show sample stickers"
          hint="Puts the “Try a sample” strip back on the scan page. Off by default so the receipt viewfinder can stay tall."
          checked={settings.debugSamples}
          onChange={(debugSamples) => patch({ debugSamples })}
        />
      </section>

      <section className="mt-10 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
        <h2 className="font-display text-2xl">What this uses</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <Row
            k="TensorFlow.js"
            v="On this phone. tfjs 4.20 from jsDelivr + MobileNet v1 0.25 224 from Google. CDN, cached after first load."
          />
          <Row
            k="PP-OCRv6"
            v="On this phone. Enabling it downloads det + rec from Hugging Face through this app (~30 MB), then caches them. The engine itself is same-origin WASM — no jsDelivr hang. Drop tars in public/models/ to skip the Hugging Face step."
          />
          <Row
            k="Local LLM"
            v="Your OpenAI-compatible server. VISION_MODEL reads photos; TEXT_MODEL collates names. URL never hard-coded — env wins, then this form."
          />
          <Row
            k="Grok"
            v="Off-device last resort. grok-4.5 via xAI when XAI_API_KEY is set. Optional."
          />
        </dl>
      </section>
    </main>
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
