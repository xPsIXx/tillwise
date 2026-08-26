# Tillwise

Camera-first grocery ledger. No accounts.

Point the phone at a produce sticker or a till slip. The photo is filed immediately; name, weight, unit price, line price, and barcode fill in the background. Aisle shots are later collated with the receipt.

v0.3 adds a spending dashboard, store trends, unit-price history, canonical product matching, receipt shop/date fill-in, and an installable PWA. The ledger still uses **PGLite** (Postgres compiled to WASM) on `/data/pglite` — same SQL as Postgres, already wired, better than switching to SQLite mid-flight.

- Repo: https://github.com/xPsIXx/tillwise
- Image: `ghcr.io/xpsixx/tillwise`
- Actions: https://github.com/xPsIXx/tillwise/actions
- Packages: https://github.com/xPsIXx/tillwise/pkgs/container/tillwise

## What you need

Nothing to sign in. To *read* photos you pick one engine in Settings:

| Reader | Needs |
|---|---|
| PP-OCRv6 (default for labels) | First-use download on the phone (~30 MB). No server. Weak on till tape. |
| Local vision LLM | A box on your LAN that speaks OpenAI `/v1/chat/completions` (llama-swap, vLLM, Ollama+proxy). |
| BYOK vision | Any remote OpenAI-compatible API + key (OpenAI, OpenRouter, Together, Groq, xAI, …). |
| Browser text | Fallback. Barcode + regex only. |

Receipts always need a vision LLM (local or BYOK). PP-OCR is a label engine.

## Environment variables

Nothing is hard-coded. **Environment wins over the Settings form.** If you leave a variable empty, you can paste the same values in Settings after the container is up. Settings can also **List models** from `/v1/models` once the endpoint and key are saved.

### Persistence

| Variable | Default | Purpose |
|---|---|---|
| `PGLITE_DATA_DIR` | `/data/pglite` in Docker, `./data/pglite` in `npm run dev` | Folder for the embedded Postgres files (trips, photos, settings, product memory). |
| `DATABASE_URL` | unset | Optional real Postgres / Neon URL. If unset, PGLite on disk is used. Set to nothing on Unraid unless you have a Postgres URL. |
| `PORT` | `8080` | HTTP port inside the container. |
| `HOST` | `0.0.0.0` | Bind address. |

`PGLITE_DATA_DIR=memory` wipes the ledger every restart.

Mount a volume at `/data` so `/data/pglite` survives image updates.

### Local vision / collate server

Used when Settings → **Local vision LLM** / **Local text LLM**.

| Variable | Example | Purpose |
|---|---|---|
| `LLM_BASE_URL` | `http://192.168.1.10:8088` | OpenAI-compatible base. No trailing `/v1` required. |
| `VISION_MODEL` | `Qwen3-VL-8B` | Model id for photos. |
| `TEXT_MODEL` | `Qwen3.5-9B` | Model id for collation. Falls back to `VISION_MODEL`. |
| `LLM_API_KEY` | *(optional)* | Bearer token if that box requires one. |

The app calls `${LLM_BASE_URL}/v1/chat/completions`. Same shape as llama-swap, vLLM, and OpenAI.

### Bring your own key (cloud / remote API)

Used when Settings → **BYOK vision** / **BYOK text**. There is no built-in xAI/Grok key.

| Variable | Example | Purpose |
|---|---|---|
| `BYOK_BASE_URL` | `https://api.openai.com` | Remote OpenAI-compatible host. Also accepts `https://openrouter.ai/api`, `https://api.x.ai`, etc. |
| `BYOK_API_KEY` | `sk-…` | API key for that host. |
| `BYOK_VISION_MODEL` | `gpt-4o-mini` | Vision model id on that host. |
| `BYOK_TEXT_MODEL` | `gpt-4o-mini` | Text model for collation. Falls back to the vision model. |

`OPENAI_BASE_URL` / `OPENAI_API_KEY` are accepted as aliases if the `BYOK_*` names are empty.

### What you can skip

All of the LLM/BYOK variables are optional. A box that only scans labels with PP-OCR needs **none** of them — only the `/data` volume.

## Docker

GitHub Actions builds and pushes the image on `main` and on `v*` tags.

```bash
docker pull ghcr.io/xpsixx/tillwise:latest
# or a release: ghcr.io/xpsixx/tillwise:v0.2.1
```

```bash
docker run -d --name tillwise -p 8080:8080 \
  -v tillwise-data:/data \
  -e PGLITE_DATA_DIR=/data/pglite \
  -e LLM_BASE_URL=http://192.168.1.10:8088 \
  -e VISION_MODEL=Qwen3-VL-8B \
  -e TEXT_MODEL=Qwen3.5-9B \
  -e BYOK_BASE_URL=https://api.openai.com \
  -e BYOK_API_KEY=sk-your-key \
  -e BYOK_VISION_MODEL=gpt-4o-mini \
  -e BYOK_TEXT_MODEL=gpt-4o-mini \
  ghcr.io/xpsixx/tillwise:latest
```

Or:

```bash
docker compose up -d
```

The process runs as `node` (uid 1000). The entrypoint starts as root just long enough to `chown` `/data`, then drops privileges. That avoids `EACCES: mkdir '/data/pglite'` on a volume created as root.

Do **not** pass `--user 99:100` (Unraid’s usual extra param). The image already drops to uid 1000.

## Unraid

Add a container from the Docker tab (or a custom template).

| Field | Value |
|---|---|
| Repository | `ghcr.io/xpsixx/tillwise:latest` |
| Network | Bridge |
| Port | Host `8080` → Container `8080` (TCP) |
| Path | Host `/mnt/user/appdata/tillwise` → Container `/data` |
| Extra parameters | Leave empty. Do not add `--user 99:100`. |

Add only the variables you use. Empty values are fine.

**Required for persistence**

- `PGLITE_DATA_DIR` = `/data/pglite`

**Optional local LLM**

- `LLM_BASE_URL`, `VISION_MODEL`, `TEXT_MODEL`, `LLM_API_KEY`

**Optional BYOK**

- `BYOK_BASE_URL`, `BYOK_API_KEY`, `BYOK_VISION_MODEL`, `BYOK_TEXT_MODEL`

Leave `DATABASE_URL` blank unless you have a Postgres URL. The small on-disk database is PGLite under `/mnt/user/appdata/tillwise/pglite`.

Open `http://TOWER-IP:8080`. After the first start, check logs — you should not see `EACCES`.

If you already ran an older image and the appdata folder is empty or still errors, update to `v0.2.1` or later and start once so the entrypoint can take ownership of `/data`.

## Develop on a machine

```bash
npm install
LLM_BASE_URL=http://192.168.1.10:8088 \
VISION_MODEL=Qwen3-VL-8B \
TEXT_MODEL=Qwen3.5-9B \
npm run dev
```

Listens on `0.0.0.0:8080`. Dev data is written to `./data/pglite`.

## Engines

**Detect (live viewfinder):** TensorFlow.js → PP-OCRv6 (tiny, throttled) → shape + barcode → barcode → manual shutter (default).

**Read (after snap):** local vision LLM → PP-OCRv6 on-device → BYOK API → browser text.

**Collate (end of trip):** local `TEXT_MODEL` → BYOK text model.

Defaults in Settings: detect off (manual shutter), read PP-OCR, collate local, add-to-cart-and-fill-in-later on.

### On-device models

- **TensorFlow.js** — CDN: tfjs 4.20.0 + MobileNet v1 0.25 224. First load ~5–10 MB.
- **PP-OCRv6** — first enable in Settings downloads det + rec from Hugging Face through a same-origin proxy (`PaddlePaddle/PP-OCRv6_{tiny,small,medium}_{det,rec}_onnx`). Packed as uncompressed ustar and cached in the browser. Engine JS + ORT wasm are vendored (`npm run build:ppocr`, also on `npm install`). Optional: drop pre-packed tars in `public/models/` to skip Hugging Face.

See `HOSTING.txt` for the short self-host cheat sheet.
