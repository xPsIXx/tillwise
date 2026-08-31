import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPpocr, ppocrReady } from "@/lib/grocery/ppocr";
import {
  COLLATE_OPTIONS,
  PPOCR_FEEL,
  PPOCR_SIZES,
  READ_OPTIONS,
  loadScanSettings,
  saveScanSettings,
  type ScanSettings,
  type VisionDetail,
} from "@/lib/grocery/settings";
import { getLlmConfig, listLlmModels, saveLlmConfig } from "@/lib/grocery/server";
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

  const showLlmForm = settings.read === "local" || settings.collate === "local";
  const showByokForm =
    settings.read === "byok" ||
    settings.read === "grok" ||
    settings.collate === "byok" ||
    settings.collate === "grok";
  const showVisionDetail = showLlmForm || showByokForm;

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Scanner</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Settings</h1>
      <p className="mt-3 max-w-lg text-sm text-muted">
        Detect on the phone, then snap. Reading and collation use the engine you pick — on-device,
        your local server, or a BYOK API.
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
        <h2 className="font-display text-2xl">PP-OCR model size</h2>
        <p className="mt-1 text-sm text-muted">
          Used after you tap the shutter. Finds text on the photo and reads it. Nothing watches
          the live camera.
        </p>
        <div className="mt-4 grid gap-2">
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
      </section>

      <section className="mt-8">
          <h2 className="font-display text-2xl">PP-OCR sensitivity</h2>
          <p className="mt-1 text-sm text-muted">
            Loose keeps small produce-sticker text. Strict ignores faint or busy background type.
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

      <section className="mt-10">
        <h2 className="font-display text-2xl">How to read it</h2>
        <p className="mt-1 text-sm text-muted">
          Labels use this reader. Till tape always needs BYOK vision — PP-OCR
          is a label engine, not a receipt layout model.
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

      <section className="mt-10">
        <h2 className="font-display text-2xl">After the snap</h2>
        <div className="mt-4 grid gap-2">
          <Choice
            title="Add to cart, fill in later"
            body="Default. The photo joins the cart as “Reading…”. PP-OCR, local vision, and BYOK all keep working in the background and patch the row when they finish. Local vision and BYOK never show a confirm sheet."
            selected={settings.autoAdd}
            onSelect={() => patch({ autoAdd: true })}
          />
          <Choice
            title="Hold for a look"
            body="Only for on-device readers (PP-OCR / browser text). You confirm the extract before it joins the cart. Local vision and BYOK still skip this sheet."
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
            k="BYOK"
            v="Your key, your endpoint. OpenAI-compatible /v1/chat/completions. Saved in Settings or BYOK_BASE_URL / BYOK_API_KEY / BYOK_VISION_MODEL / BYOK_TEXT_MODEL."
          />
        </dl>
      </section>
    </main>
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
