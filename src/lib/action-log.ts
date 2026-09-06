import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logsRoot } from "@/lib/photo-store";

export type ActionEvent = {
  t: string;
  action: string;
  ok: boolean;
  tripId?: number;
  detail?: string;
};

function logFile() {
  const dir = logsRoot();
  mkdirSync(dir, { recursive: true });
  return join(dir, "actions.jsonl");
}

export function recordAction(event: Omit<ActionEvent, "t">): void {
  try {
    const file = logFile();
    if (existsSync(file) && statSync(file).size > 2_000_000) {
      // keep the tail
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n").filter(Boolean);
      const keep = lines.slice(-80).join("\n") + "\n";
      writeFileSync(file, keep);
    }
    const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n";
    appendFileSync(file, line);
  } catch (err) {
    console.warn("[action-log]", err);
  }
}

export function readActions(limit = 200): ActionEvent[] {
  try {
    const file = logFile();
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    const slice = lines.slice(-limit);
    const out: ActionEvent[] = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as ActionEvent);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}
