# Tillwise

Camera-first grocery ledger. No accounts. Detect on the phone, read in the background, collate aisle stickers with the till tape.

## Run

```bash
npm install
LLM_BASE_URL=http://192.168.1.2:8088 \
VISION_MODEL=Qwen3-VL-8B \
TEXT_MODEL=Qwen3.5-9B \
npm run dev
```

Listens on `0.0.0.0:8080`. Open it from your phone on the same network.

## Environment

Never hard-coded. Env vars win over the Settings form.

| Variable | Purpose |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible base, no trailing `/v1` (e.g. `http://192.168.1.2:8088`) |
| `VISION_MODEL` | Vision LLM for labels + receipts (e.g. `Qwen3-VL-8B`) |
| `TEXT_MODEL` | Text LLM for collation / name grouping (e.g. `Qwen3.5-9B`). Falls back to `VISION_MODEL`. |
| `LLM_API_KEY` | Optional bearer token for the local server |
| `XAI_API_KEY` | Optional. Only if you want Grok as a reader/collate option |
| `DATABASE_URL` | Optional Postgres URL. If unset, PGLite (embedded) is used |

The app calls `${LLM_BASE_URL}/v1/chat/completions` with `VISION_MODEL` for photos and `TEXT_MODEL` for collation. Same shape as llama-swap / vLLM / OpenAI.

If `LLM_BASE_URL` is not in the environment, Settings can save the same values into the local database.

## Engines

**Detect:** TensorFlow.js → PP-OCRv6 → shape+barcode → barcode → manual

**Read:** local vision LLM → PP-OCRv6 on-device → Grok → browser text

**Collate:** local `TEXT_MODEL` → Grok

Receipts always use a vision LLM (local or Grok). PP-OCR is a label engine.

Defaults: detect = shape (no download), read = local, collate = local.

### On-device models

- **TensorFlow.js** — CDN: tfjs 4.20.0 + MobileNet v1 0.25 224. First load ~5–10 MB.
- **PP-OCRv6** — first time you enable it in Settings, the app downloads det + rec from Hugging Face (`PaddlePaddle/PP-OCRv6_small_*_onnx`) through a same-origin proxy, packs `inference.onnx` + `inference.yml` into ustar tars, and caches them on the phone (~30 MB). The engine JS + ORT wasm are vendored same-origin (`npm run build:ppocr`, also on `npm install`). Optional: drop pre-packed tars in `public/models/` to skip the Hugging Face step.

See `HOSTING.txt` for the short self-host cheat sheet.


## Docker

GitHub Actions on `main` publishes `ghcr.io/xpsixx/tillwise:latest`.

```bash
docker pull ghcr.io/xpsixx/tillwise:latest
docker run -d --name tillwise -p 8080:8080 \
  -v tillwise-data:/data \
  -e LLM_BASE_URL=http://192.168.1.2:8088 \
  -e VISION_MODEL=Qwen3-VL-8B \
  -e TEXT_MODEL=Qwen3.5-9B \
  ghcr.io/xpsixx/tillwise:latest
```

Trips, photos, and settings live in an embedded Postgres (PGLite) on the
`tillwise-data` volume at `/data/pglite`. No separate database to install.
Point `DATABASE_URL` at Neon or any Postgres only if you outgrow that file.

- Repo: https://github.com/xPsIXx/tillwise
- Actions: https://github.com/xPsIXx/tillwise/actions
- Image: https://github.com/xPsIXx/tillwise/pkgs/container/tillwise
