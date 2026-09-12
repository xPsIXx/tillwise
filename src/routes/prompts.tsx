import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  draftShopNotes,
  getPromptPack,
  resetPromptPack,
  savePromptPack,
  testLastShot,
} from "@/lib/grocery/server";
import {
  DEFAULT_PROMPTS,
  PROMPT_KEYS,
  PROMPT_META,
  withShopNote,
  type PromptKey,
  type PromptPack,
} from "@/lib/grocery/prompts";

export const Route = createFileRoute("/prompts")({ component: PromptsPage });

function PromptsPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["prompts"], queryFn: () => getPromptPack() });
  const [pack, setPack] = useState<PromptPack | null>(null);
  const [tab, setTab] = useState<PromptKey | "shops">("label");
  const [previewShop, setPreviewShop] = useState<string>("");
  const [testOut, setTestOut] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const { knownShops: _k, ...rest } = query.data;
      void _k;
      setPack({ aliases: {}, ...rest });
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: (next: PromptPack) => savePromptPack({ data: next }),
    onSuccess: (next) => {
      setPack(next);
      toast.success("Prompts saved");
      void qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save"),
  });

  const reset = useMutation({
    mutationFn: () => resetPromptPack(),
    onSuccess: (next) => {
      setPack(next);
      toast.success("Restored defaults");
      void qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not reset"),
  });

  const draft = useMutation({
    mutationFn: (store: string) => draftShopNotes({ data: store }),
    onSuccess: (res, store) => {
      setPack((cur) => (cur ? { ...cur, shops: { ...cur.shops, [store]: res.notes } } : cur));
      toast.success(`Drafted notes for ${store} — save to keep them`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not draft notes"),
  });

  const test = useMutation({
    mutationFn: (input: { kind: "label" | "receipt"; storeName?: string | null; promptOverride: string }) =>
      testLastShot({ data: input }),
    onSuccess: (res) => {
      setTestOut(JSON.stringify({ store: res.storeName, shotId: res.shotId, ...res.result }, null, 2));
      toast.success("Ran on last photo — nothing was saved to the trip");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not test"),
  });

  const shopNames = useMemo(() => {
    if (!pack) return [];
    return Object.keys(pack.shops)
      .filter((name) => !pack.aliases[name] || pack.aliases[name] === name)
      .sort((a, b) => a.localeCompare(b));
  }, [pack]);

  if (!pack) {
    return (
      <main className="pb-10 pt-6">
        <p className="text-sm text-muted">Loading prompts…</p>
      </main>
    );
  }

  const preview = tab !== "shops" ? withShopNote(pack[tab], pack, previewShop || null) : "";

  return (
    <main className="pb-10 pt-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Settings</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Model prompts</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        One global prompt per job. Shop notes append for that chain. Aliases share one note across
        Lulu / LuLu Hypermarket / Lulu Al Wahda.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {PROMPT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg"
                : "rounded-full bg-elevated px-3 py-1.5 text-xs font-medium text-muted"
            }
          >
            {PROMPT_META[key].title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setTab("shops")}
          className={
            tab === "shops"
              ? "rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg"
              : "rounded-full bg-elevated px-3 py-1.5 text-xs font-medium text-muted"
          }
        >
          Shop notes
        </button>
      </div>

      {tab !== "shops" ? (
        <section className="mt-6">
          <h2 className="font-display text-2xl">{PROMPT_META[tab].title}</h2>
          <p className="mt-1 text-sm text-muted">{PROMPT_META[tab].hint}</p>
          <textarea
            className="mt-3 h-64 w-full rounded-md border border-border bg-bg p-3 font-mono text-xs leading-relaxed"
            value={pack[tab]}
            onChange={(e) => setPack({ ...pack, [tab]: e.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            className="mt-2 text-muted"
            onClick={() => setPack({ ...pack, [tab]: DEFAULT_PROMPTS[tab] })}
          >
            Restore this default
          </Button>
          <h3 className="mt-6 text-sm font-medium">Assembled preview</h3>
          <p className="mt-1 text-xs text-muted">
            What the model actually gets: this prompt plus the shop note, if any.
          </p>
          <select
            className="mt-2 h-10 rounded-md border border-border bg-bg px-3 text-sm"
            value={previewShop}
            onChange={(e) => setPreviewShop(e.target.value)}
          >
            <option value="">No shop note</option>
            {shopNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <textarea
            readOnly
            className="mt-2 h-40 w-full rounded-md border border-border bg-elevated p-3 font-mono text-xs leading-relaxed text-muted"
            value={preview}
          />
          {(tab === "label" || tab === "receipt") && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={test.isPending}
              onClick={() =>
                test.mutate({
                  kind: tab,
                  storeName: previewShop || null,
                  promptOverride: preview,
                })
              }
            >
              {test.isPending ? "Reading last photo…" : `Test on last ${tab === "receipt" ? "till" : "label"}`}
            </Button>
          )}
        </section>
      ) : (
        <section className="mt-6">
          <h2 className="font-display text-2xl">Shop notes</h2>
          <p className="mt-1 text-sm text-muted">
            Names that look like the same chain share one note. Draft uses the last till (or sticker)
            photo for that shop.
          </p>
          {shopNames.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No named shops yet. Put a store on a trip.</p>
          ) : (
            <ul className="mt-4 space-y-6">
              {shopNames.map((store) => {
                const also = Object.entries(pack.aliases)
                  .filter(([, to]) => to === store)
                  .map(([from]) => from);
                return (
                  <li key={store}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium">{store}</h3>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-muted"
                          disabled={draft.isPending}
                          onClick={() => draft.mutate(store)}
                        >
                          {draft.isPending && draft.variables === store
                            ? "Drafting…"
                            : "Draft from last photo"}
                        </Button>
                      </div>
                    </div>
                    {also.length > 0 ? (
                      <p className="mt-1 text-xs text-muted">Also: {also.join(", ")}</p>
                    ) : null}
                    <textarea
                      className="mt-2 h-28 w-full rounded-md border border-border bg-bg p-3 text-sm"
                      placeholder="Optional extra instructions for this shop"
                      value={pack.shops[store] ?? ""}
                      onChange={(e) =>
                        setPack({ ...pack, shops: { ...pack.shops, [store]: e.target.value } })
                      }
                    />
                    <label className="mt-2 block text-xs text-muted">
                      Also known as (comma-separated)
                      <Input
                        className="mt-1"
                        defaultValue={also.join(", ")}
                        key={`${store}:${also.join("|")}`}
                        placeholder="LuLu Hypermarket, Lulu Al Wahda"
                        onBlur={(e) => {
                          const next = { ...pack.aliases };
                          for (const [from, to] of Object.entries(next)) {
                            if (to === store) delete next[from];
                          }
                          for (const raw of e.target.value.split(",")) {
                            const from = raw.trim();
                            if (from && from !== store) next[from] = store;
                          }
                          setPack({ ...pack, aliases: next });
                        }}
                      />
                    </label>
                    {shopNames.length > 1 ? (
                      <label className="mt-2 block text-xs text-muted">
                        Merge into
                        <select
                          className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
                          defaultValue=""
                          onChange={(e) => {
                            const to = e.target.value;
                            if (!to || to === store) return;
                            const notes = pack.shops[to]?.trim() ? pack.shops[to] : pack.shops[store];
                            const { [store]: _drop, ...rest } = pack.shops;
                            void _drop;
                            setPack({
                              ...pack,
                              shops: { ...rest, [to]: notes ?? "" },
                              aliases: { ...pack.aliases, [store]: to },
                            });
                          }}
                        >
                          <option value="">Keep as its own shop</option>
                          {shopNames
                            .filter((n) => n !== store)
                            .map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {testOut ? (
        <section className="mt-8">
          <h3 className="text-sm font-medium">Last test (not saved to the trip)</h3>
          <textarea
            readOnly
            className="mt-2 h-48 w-full rounded-md border border-border bg-elevated p-3 font-mono text-xs"
            value={testOut}
          />
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button type="button" onClick={() => save.mutate(pack)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save prompts"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => reset.mutate()} disabled={reset.isPending}>
          Restore all defaults
        </Button>
        <Button asChild variant="ghost">
          <Link to="/settings">Back to settings</Link>
        </Button>
      </div>
    </main>
  );
}
