import { getSql } from "@/lib/db";
import type { LlmProvider } from "./types";

export type { LlmProvider };

export type LlmConfig = {
  localAvailable: boolean;
  byokAvailable: boolean;
  /** @deprecated use byokAvailable */
  grokAvailable: boolean;
  localUrl: string | null;
  visionModel: string | null;
  textModel: string | null;
  hasLocalKey: boolean;
  byokUrl: string | null;
  byokVisionModel: string | null;
  byokTextModel: string | null;
  hasByokKey: boolean;
  source: "env" | "saved" | "none";
  localLocked: boolean;
  byokLocked: boolean;
};

function trim(v: string | undefined | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function env(name: string): string | null {
  return trim(process.env[name]);
}

async function readSaved(): Promise<Record<string, string>> {
  try {
    const sql = await getSql();
    const rows = await sql<{ key: string; value: string }>`select key, value from app_settings`;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

export function chatCompletionsUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

export function modelsUrl(base: string): string {
  const b = base.trim().replace(/\/+$/, "");
  if (/\/models$/i.test(b)) return b;
  if (/\/v1$/i.test(b)) return `${b}/models`;
  if (/\/chat\/completions$/i.test(b)) return b.replace(/\/chat\/completions$/i, "/models");
  return `${b}/v1/models`;
}

function parseModelIds(payload: unknown): string[] {
  const ids = new Set<string>();
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const data = obj.data;
    if (Array.isArray(data)) {
      for (const row of data) {
        if (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") {
          ids.add((row as { id: string }).id);
        } else if (typeof row === "string") ids.add(row);
      }
    }
    const models = obj.models;
    if (Array.isArray(models)) {
      for (const row of models) {
        if (typeof row === "string") ids.add(row);
        else if (row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string") {
          ids.add((row as { id: string }).id);
        }
      }
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export async function listRemoteModels(input: {
  which: "local" | "byok";
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<{ models: string[]; error: string | null; url: string | null }> {
  const cfg = await loadLlmConfig();
  const saved = await readSaved();
  const base =
    trim(input.baseUrl) ??
    (input.which === "byok" ? cfg.byokUrl : cfg.localUrl);
  if (!base) {
    return { models: [], error: "Add an endpoint first.", url: null };
  }
  const key =
    trim(input.apiKey) ??
    (input.which === "byok"
      ? env("BYOK_API_KEY") ?? trim(saved.byok_api_key) ?? env("OPENAI_API_KEY")
      : env("LLM_API_KEY") ?? trim(saved.llm_api_key));
  const url = modelsUrl(base);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: `Could not list models (${res.status}). ${body.slice(0, 160)}`.trim(),
        url,
      };
    }
    const payload = await res.json().catch(() => null);
    const models = parseModelIds(payload);
    if (!models.length) {
      return { models: [], error: "The endpoint returned no model ids.", url };
    }
    return { models, error: null, url };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Listing models timed out."
        : err instanceof Error
          ? err.message
          : "Could not list models.";
    return { models: [], error: message, url };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadLlmConfig(): Promise<LlmConfig> {
  const saved = await readSaved();
  const envUrl = env("LLM_BASE_URL");
  const localUrl = envUrl ?? trim(saved.llm_base_url);
  const visionModel = env("VISION_MODEL") ?? trim(saved.vision_model);
  const textModel = env("TEXT_MODEL") ?? trim(saved.text_model) ?? visionModel;
  const hasLocalKey = Boolean(env("LLM_API_KEY") ?? trim(saved.llm_api_key));

  const byokUrl =
    env("BYOK_BASE_URL") ?? trim(saved.byok_base_url) ?? env("OPENAI_BASE_URL");
  const byokVisionModel =
    env("BYOK_VISION_MODEL") ?? trim(saved.byok_vision_model) ?? env("OPENAI_VISION_MODEL");
  const byokTextModel =
    env("BYOK_TEXT_MODEL") ??
    trim(saved.byok_text_model) ??
    env("OPENAI_TEXT_MODEL") ??
    byokVisionModel;
  const hasByokKey = Boolean(
    env("BYOK_API_KEY") ?? trim(saved.byok_api_key) ?? env("OPENAI_API_KEY"),
  );

  const source: LlmConfig["source"] = envUrl || env("BYOK_BASE_URL")
    ? "env"
    : localUrl || byokUrl
      ? "saved"
      : "none";

  const byokAvailable = Boolean(byokUrl && byokVisionModel && hasByokKey);
  return {
    localAvailable: Boolean(localUrl && visionModel),
    byokAvailable,
    grokAvailable: byokAvailable,
    localUrl,
    visionModel,
    textModel,
    hasLocalKey,
    byokUrl,
    byokVisionModel,
    byokTextModel,
    hasByokKey,
    source,
    localLocked: Boolean(envUrl),
    byokLocked: Boolean(env("BYOK_BASE_URL")),
  };
}

export async function saveLlmConfig(input: {
  localUrl?: string | null;
  visionModel?: string | null;
  textModel?: string | null;
  apiKey?: string | null;
  byokUrl?: string | null;
  byokVisionModel?: string | null;
  byokTextModel?: string | null;
  byokApiKey?: string | null;
}) {
  if (env("LLM_BASE_URL") && env("BYOK_BASE_URL")) {
    throw new Error("Endpoints are set on the server — edit the environment, not this form.");
  }
  const sql = await getSql();
  const rows: [string, string | null][] = [];
  if (!env("LLM_BASE_URL")) {
    if (input.localUrl !== undefined) rows.push(["llm_base_url", trim(input.localUrl)]);
    if (input.visionModel !== undefined) rows.push(["vision_model", trim(input.visionModel)]);
    if (input.textModel !== undefined) rows.push(["text_model", trim(input.textModel)]);
    if (input.apiKey !== undefined) rows.push(["llm_api_key", trim(input.apiKey)]);
  }
  if (!env("BYOK_BASE_URL")) {
    if (input.byokUrl !== undefined) rows.push(["byok_base_url", trim(input.byokUrl)]);
    if (input.byokVisionModel !== undefined) {
      rows.push(["byok_vision_model", trim(input.byokVisionModel)]);
    }
    if (input.byokTextModel !== undefined) rows.push(["byok_text_model", trim(input.byokTextModel)]);
    if (input.byokApiKey !== undefined) rows.push(["byok_api_key", trim(input.byokApiKey)]);
  }
  for (const [key, value] of rows) {
    if (!value) {
      await sql`delete from app_settings where key = ${key}`;
    } else {
      await sql`
        insert into app_settings (key, value) values (${key}, ${value})
        on conflict (key) do update set value = excluded.value
      `;
    }
  }
  return loadLlmConfig();
}

export async function resolveEndpoint(provider: LlmProvider, task: "vision" | "text") {
  const cfg = await loadLlmConfig();
  const remote = provider === "byok" || provider === "grok";
  if (remote) {
    if (!cfg.byokUrl) {
      throw new Error("Set a BYOK endpoint (OpenAI-compatible base URL) in Settings.");
    }
    const model = task === "text" ? cfg.byokTextModel : cfg.byokVisionModel;
    if (!model) {
      throw new Error(task === "text" ? "Set a BYOK text model." : "Set a BYOK vision model.");
    }
    if (!cfg.hasByokKey) throw new Error("Set a BYOK API key in Settings.");
    const saved = await readSaved();
    const apiKey =
      env("BYOK_API_KEY") ?? trim(saved.byok_api_key) ?? env("OPENAI_API_KEY");
    return {
      url: chatCompletionsUrl(cfg.byokUrl),
      model,
      apiKey,
      jsonMode: true,
      timeoutMs: 90_000,
    };
  }
  if (!cfg.localUrl) {
    throw new Error("Set LLM_BASE_URL (or save it in Settings) for your local model.");
  }
  const model = task === "text" ? cfg.textModel : cfg.visionModel;
  if (!model) {
    throw new Error(task === "text" ? "Set TEXT_MODEL." : "Set VISION_MODEL.");
  }
  const saved = await readSaved();
  const apiKey = env("LLM_API_KEY") ?? trim(saved.llm_api_key);
  return {
    url: chatCompletionsUrl(cfg.localUrl),
    model,
    apiKey,
    jsonMode: false,
    timeoutMs: 180_000,
  };
}
