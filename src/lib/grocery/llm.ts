import { getSql } from "@/lib/db";
import type { LlmProvider } from "./types";

export type { LlmProvider };

export type LlmConfig = {
  grokAvailable: boolean;
  localAvailable: boolean;
  localUrl: string | null;
  visionModel: string | null;
  textModel: string | null;
  hasLocalKey: boolean;
  source: "env" | "saved" | "none";
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

export async function loadLlmConfig(): Promise<LlmConfig> {
  const saved = await readSaved();
  const envUrl = env("LLM_BASE_URL");
  const envVision = env("VISION_MODEL");
  const envText = env("TEXT_MODEL");
  const envKey = env("LLM_API_KEY");
  const localUrl = envUrl ?? trim(saved.llm_base_url);
  const visionModel = envVision ?? trim(saved.vision_model);
  const textModel = envText ?? trim(saved.text_model) ?? visionModel;
  const hasLocalKey = Boolean(envKey ?? trim(saved.llm_api_key));
  const source: LlmConfig["source"] = envUrl
    ? "env"
    : localUrl
      ? "saved"
      : "none";
  return {
    grokAvailable: Boolean(env("XAI_API_KEY")),
    localAvailable: Boolean(localUrl && visionModel),
    localUrl,
    visionModel,
    textModel,
    hasLocalKey,
    source,
  };
}

export async function saveLlmConfig(input: {
  localUrl?: string | null;
  visionModel?: string | null;
  textModel?: string | null;
  apiKey?: string | null;
}) {
  if (env("LLM_BASE_URL")) {
    throw new Error("LLM_BASE_URL is set on the server — edit the environment, not this form.");
  }
  const sql = await getSql();
  const rows: [string, string | null][] = [
    ["llm_base_url", trim(input.localUrl)],
    ["vision_model", trim(input.visionModel)],
    ["text_model", trim(input.textModel)],
  ];
  if (input.apiKey !== undefined) {
    rows.push(["llm_api_key", trim(input.apiKey)]);
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
  if (provider === "grok") {
    const key = env("XAI_API_KEY");
    if (!key) throw new Error("Grok is not configured (missing XAI_API_KEY).");
    return {
      url: "https://api.x.ai/v1/chat/completions",
      model: "grok-4.5",
      apiKey: key,
      jsonMode: true,
      timeoutMs: 60_000,
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
  const base = cfg.localUrl.replace(/\/+$/, "");
  return {
    url: `${base}/v1/chat/completions`,
    model,
    apiKey,
    jsonMode: false,
    timeoutMs: 180_000,
  };
}
