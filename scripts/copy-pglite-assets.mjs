import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const destDirs = [
  // Vercel / Nitro vercel preset
  join(root, ".vercel/output/functions/__server.func/_libs"),
  // Nitro node-server (Docker / `npm start`)
  join(root, ".output/server/_libs"),
];

const names = ["pglite.data", "pglite.wasm", "initdb.wasm"];

let copied = 0;
for (const destDir of destDirs) {
  if (!existsSync(dirname(destDir)) && !existsSync(destDir)) {
    continue;
  }
  mkdirSync(destDir, { recursive: true });
  for (const name of names) {
    const from = join(srcDir, name);
    if (!existsSync(from)) continue;
    copyFileSync(from, join(destDir, name));
    console.log(`[pglite] copied ${name} → ${destDir}`);
    copied += 1;
  }
}

if (copied === 0) {
  console.log("[pglite] no server output dir yet — skip");
}
