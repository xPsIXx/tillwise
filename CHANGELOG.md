# Changelog

All notable Tillwise releases. Dates are when the tag landed on GitHub.

## 0.3.23 — 2026-09-12

- Till snaps: Low / High / Ultra quality in Settings. Ultra keeps ~4K for a whole slip. Several portions still stitch. Debug samples include the full receipt again.

## 0.3.22 — 2026-09-12

- Trip: tapping a label photo no longer crashes (`weight is not defined`).

## 0.3.21 — 2026-09-12

- Open Prices shop: “Use my location” lists grocery shops on the map near you. One tap sets the exact branch (OSM pin). Typed search still works.

## 0.3.20 — 2026-09-12

- Home + Scan: log a shelf price without a trip. Saved to your price history per shop. Optionally sent to Open Prices as a price-tag proof. Shop name comes from Settings (OSM), not the sticker.

## 0.3.19 — 2026-09-12

- Open Prices: till photo only (labels not sent). Preview of the redacted slip before send. Card/loyalty boxes from the till read (footer fallback). Check mark = already sent.
- Removed MOET scrape.
## 0.3.18 — 2026-09-12

- Docker build: extra `)}` on the trip edit sheet. Header version is v0.3.18. Catalog on Stats from 0.3.17 is in this image.

## 0.3.17 — 2026-09-12

- Stats: Catalog (search name/barcode, sort cheapest/rising/recent, shops + history, CSV). Spend is a separate view.

## 0.3.16 — 2026-09-12

- Debug this trip / Full debug wait up to 10 minutes. The prompt is compacted (no pretty JSON, no full OCR dumps).
- Collate always uses the BYOK text model. Debug write-up appears in a box on Settings — copy it and paste it into this chat.
- Trip page: Scan / Receipt / Collate / File as a 2×2 row. Add line, re-read, delete, CSV under More.
- Cart rows: Pair / Unmatch / Edit / Remove only. Tap the photo to open it. Catalog “Match product” is gone from the trip.
- Settings: How to read and BYOK first. PP-OCR size/feel behind Reading options. Empty collation block and Local LLM blurb removed.
- Settings → Export JSON or CSV of trips and lines (no photos).
- Settings → Edit model prompts. Shop aliases (Lulu = LuLu Hypermarket). Prompt preview with shop notes. Test on last photo. Draft notes from the photo.
- File trip maps stats keys in the background. Printed cart names are not replaced. Variety stays (cherry tomato ≠ tomato); country drops (SA Gala = Gala).
- Stats: Produce prices — cheapest shop and history per item. Tap a produce row to fix the stats key (cart names stay). Remap old trips is optional.
- Search across trips (Home, Prices, or /search). Last paid toast after a label reads.
- Trip: add a line without a photo, retry photos that couldn’t be read, merge duplicate cart rows. Re-read passes the store name.

## 0.3.15 — 2026-09-12

- Unread photos show a banner and **Continue reading** — they do not start by themselves.
- On the collate sheet and on the trip, tap a label-only line then a till-only line to pair them by hand.

## 0.3.14 — 2026-09-06

- Collate shows a confirm sheet (label ↔ till, leftovers, printed total vs line sum) and does not write until Confirm. Cart keeps one row per label; photos keep their item ids. Matched lines show the till name and can be unmatched. Unmatched sit in their own list. File trip asks once if leftovers remain.
- Settings → Debug: **Debug this trip** and **Full debug**, with a copyable report box.

## 0.3.13 — 2026-09-06

- Header shows the app version under the Tillwise name.
- Opening a receipt or label photo no longer crashes (`tripDate is not defined`).
- Settings: Ledger sits at the bottom of the page.
- Trip: **Debug this trip** and **Full debug**. Copy report includes cart/till extracts, settings, ledger facts, and an action log (`/data/logs/actions.jsonl`). No pictures, no API key.
- Photos live under `/data/photos` on the same mapped share. The ledger only keeps a path. On start, leftover `data:` blobs are copied out; if none, that pass does nothing. Trip pages load `/media/shot/…` instead of fat base64.
- Checkpoint after create trip, snap, receipt, collate, file, reopen, and delete so an Unraid kill does not rewind the last session.

## 0.3.12 — 2026-09-06

- Repair probe loads PGLite from the app directory (v0.3.11 looked in `/tmp` and reported a missing `@electric` package). WAL reset for Postgres 18 already ran on your share.

## 0.3.11 — 2026-09-06

- Repair ledger works on Postgres 18 (this image). The previous button skipped the log reset because it only knew 17. Errors no longer dump minified JS.

## 0.3.10 — 2026-09-06

- Settings → **Repair ledger** is one button: copy aside, clear pid, reset torn WAL, then verify trips in a fresh Node process. Restarts only if that probe can read the ledger. Never deletes the live folder.
- Container start strips a leftover `postmaster.pid`. That file coming back while the app is running is normal.

## 0.3.9 — 2026-09-06

- Ledger path is hard-coded to `/data/pglite`. Map one host folder to `/data`. `PGLITE_DATA_DIR` is ignored. Do not fall back to `/tmp`.
- Settings → Ledger: check PG_VERSION, leftover `postmaster.pid`, and attempt repair (copy aside first, then clear locks and reset torn WAL). Never deletes the live folder. After repair the process exits so Docker starts a fresh one (WASM cannot recover after `Aborted()`).

## 0.3.8 — 2026-09-06

- Scale-sticker names prefer the printed produce line (`Capsicum Yellow`, `Australian Carrots`) over store-logo OCR (`LuCug`).
- BYOK reprocess uses the original photo (not the thumbnail), writes the new name onto the open shot, and ignores a previous bad name in memory.
- Trip button **Labels, then till slips with BYOK** reads every label first, then every till slip.
- Those BYOK runs batch photos into one vision call (up to 8 labels or 4 till slips per request) instead of one call per photo.

## 0.3.7 — 2026-08-31

- Restore the v0.3.3 camera pipeline that already worked: `facingMode: ideal environment`, then unconstrained `{ video: true }`. No timeouts that abort `getUserMedia`, no front/rear label guessing.

## 0.3.6 — 2026-08-31

- Camera starts on any working stream (with a timeout) instead of hanging on 1080p `environment` constraints. The overlay clears as soon as a track is live, then we switch to the rear camera.

## 0.3.5 — 2026-08-31

- Camera start: Android labels like `facing back` were treated as the selfie cam (`face` matched `facing`), so every rear stream was dropped.

## 0.3.4 — 2026-08-31

- Prefer the rear camera: `facingMode: environment` first, then a labelled back camera after permission. Do not guess the last unlabeled device.
- Filed trips stay editable. Reopen puts one back into shopping so you can scan and file again.
- Trip page: **Reprocess labels with PP-OCR** runs the on-device det+rec pipeline on every label photo (one at a time). **Send all through BYOK** still covers labels and till slips.

## 0.3.3 — 2026-08-31

- Manual shutter only: removed When to snap, auto-capture, live detector, TensorFlow/shape/barcode lock, and leftover detect settings. You tap; then PP-OCR or BYOK reads the photo.
- Removed the Recognition model picker from Settings and the Read / Detection pickers from the label scan page. One PP-OCR size in Settings is used after the snap.

## 0.3.2 — 2026-08-30

- Scan queue claims each photo once (up to 3 BYOK reads at a time) so responses are not dropped or double-fired. The shutter does not wait for the model.
- Detection model size is used to find text boxes before recognition, including with a manual shutter. Size pickers stay visible in Settings and on Scan.
- Cart names stay as printed on the sticker (`Australian Carrots`). Analytics has **Build common names** to roll origin variants into Onion / Carrots for charts.
- Trip page can reprocess every till slip in one tap.

## 0.3.1 — 2026-08-27

- Larger label viewfinder so you can line the sticker up inside the box.
- Snap crops to that box (not a tiny live-detect rectangle).
- PP-OCR recognition runs in a WASM worker so the camera stays live; you can snap the next label while one is still reading.
- Scale-sticker parser treats stacked Lulu labels as separate clusters and keeps the set whose weight × unit price matches the line total (so 0.478 kg / 19.95 / 9.55 does not mix with 0.752 kg / 10.95 / 8.25).
- Product names keep the sticker wording; OCR still drops junk like `jgl`.

## 0.3.0 — 2026-08-26

- Analytics dashboard: spend over time, store trends, average basket, prices going up or easing, unit price by store.
- Canonical products with aliases, filled during scan and collation.
- Match / rematch a shopping-list line to a canonical product.
- Receipt header (shop name, location, date) writes onto the trip.
- Installable PWA (`/manifest.webmanifest`, service worker, Install button).
- Kept PGLite on `/data/pglite` instead of switching to SQLite.

## 0.2.2 — 2026-08-26

- README documents every environment variable, Docker, and Unraid.

## 0.2.1 — 2026-08-26

- Docker entrypoint `chown`s `/data` then drops to `node`.
- Fixes `EACCES: mkdir '/data/pglite'` on Unraid / named volumes.

## 0.2.0 — 2026-08-26

- BYOK vision and collate (endpoint, models, API key) replace the built-in Grok path.
- Dropdown of models from `/v1/models` after the key is saved.
- Photo tags: pending / reading / in cart / failed, plus confidence.
- Persistent bottom nav on the scan page; manual shutter default.
- Separate PP-OCR detection and recognition sizes.
- GCC scale stickers: weight, unit price, line total, barcode.
- Higher-quality till-slip capture; label crop from the viewfinder.

## 0.1 — earlier

- First Docker image on GHCR, PGLite persistence, catalog / price memory, scan history and reprocess, camera preview and on-device PP-OCR.

## Commit log

| Hash | Title |
|---|---|
| fd755db | v0.3: analytics, canonical products, receipt shop/date, installable PWA |
| 4b3dc20 | Document Docker, Unraid, and every environment variable in the README |
| 7a392f5 | Fix PGLite EACCES on Docker volumes by chowning /data at start |
| fee407a | List models from BYOK and local endpoints as dropdowns |
| 7d00fb9 | Replace built-in Grok with BYOK endpoint and API key |
| ea2b23a | Tag photos as pending, reading, in cart, or failed with confidence |
| d4726dc | Persistent scan nav, manual shutter, split OCR sizes, confidence |
| 651d5bb | Parse GCC scale stickers: weight, unit price, total, barcode |
| 3818f24 | Extract unit price and barcode; crop labels; keep till slips sharp |
| c2d2a49 | Persist PGLite to /data so Docker volumes keep trips |
| dc2c3a2 | Docker: copy PGLite wasm/data next to the Nitro server bundle |
| 5c15596 | Docker: skip postinstall until scripts/ is in the image |
| e02020f | Docker: use npm install until the lockfile is regenerated |
| 6b2986d | Add GHCR Docker build, catalog memory, and price history |
| 13ba682 | Fix collation photo links, scan start, and on-device matching |
| 2ffc637 | Register /shots route and receipt reprocess default |
| a773c8e | Keep every scan photo and let you reprocess it |
| 948d484 | Fix black camera preview and keep PP-OCR compiled in-tab |
| 171030d | Show the camera feed before PP-OCR compiles WASM |
| 05b6550 | Keep the camera feed after permission is granted |
