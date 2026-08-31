# Changelog

All notable Tillwise releases. Dates are when the tag landed on GitHub.

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
