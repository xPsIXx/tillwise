import { getSql } from "@/lib/db";
import {
  DEFAULT_PROMPTS,
  emptyPromptPack,
  type PromptKey,
  type PromptPack,
} from "./prompts";

const KEY = "prompt_pack";

export async function loadPromptPack(): Promise<PromptPack> {
  const pack = emptyPromptPack();
  try {
    const sql = await getSql();
    const rows = await sql<{ value: string }>`select value from app_settings where key = ${KEY} limit 1`;
    const raw = rows[0]?.value;
    if (!raw) return pack;
    const parsed = JSON.parse(raw) as Partial<PromptPack>;
    for (const k of Object.keys(DEFAULT_PROMPTS) as PromptKey[]) {
      if (typeof parsed[k] === "string" && parsed[k]!.trim()) pack[k] = parsed[k]!;
    }
    if (parsed.shops && typeof parsed.shops === "object") {
      pack.shops = Object.fromEntries(
        Object.entries(parsed.shops).filter(([, v]) => typeof v === "string"),
      );
    }
    if (parsed.aliases && typeof parsed.aliases === "object") {
      pack.aliases = Object.fromEntries(
        Object.entries(parsed.aliases).filter(
          ([k, v]) => typeof k === "string" && typeof v === "string" && k.trim() && v.trim(),
        ),
      );
    }
  } catch {
    /* defaults */
  }
  return pack;
}

export async function savePromptPack(next: PromptPack): Promise<PromptPack> {
  const sql = await getSql();
  const clean: PromptPack = { ...emptyPromptPack(), shops: {}, aliases: {} };
  for (const k of Object.keys(DEFAULT_PROMPTS) as PromptKey[]) {
    const v = next[k]?.trim();
    clean[k] = v || DEFAULT_PROMPTS[k];
  }
  for (const [store, note] of Object.entries(next.shops ?? {})) {
    const name = store.trim();
    if (name) clean.shops[name] = note.trim();
  }
  for (const [alias, canon] of Object.entries(next.aliases ?? {})) {
    const from = alias.trim();
    const to = canon.trim();
    if (from && to && from !== to) clean.aliases[from] = to;
  }
  await sql`
    insert into app_settings (key, value) values (${KEY}, ${JSON.stringify(clean)})
    on conflict (key) do update set value = excluded.value
  `;
  return clean;
}
