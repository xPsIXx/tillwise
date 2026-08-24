#!/usr/bin/env node
/**
 * Vendor PaddleOCR.js + OpenCV.js as a same-origin IIFE, and copy the ORT wasm
 * the engine needs. Hugging Face model tars are NOT bundled — they download
 * the first time PP-OCR is enabled.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, ".vendor-ppocr");
const outJs = join(root, "public/ppocr/paddleocr.bundle.js");
const outOrt = join(root, "public/ort");
const loader = join(root, "scripts/ppocr-loader.mjs");

function sh(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function writeShim(dir, name, fns) {
  const body = `"use strict";\n${fns.map((fn) => `function ${fn}(){ return null; }`).join("\n")}\nmodule.exports = { ${fns.join(", ")} };\n`;
  writeFileSync(join(dir, `${name}.js`), body);
}

mkdirSync(join(root, "public/ppocr"), { recursive: true });
mkdirSync(outOrt, { recursive: true });
mkdirSync(vendor, { recursive: true });

if (!existsSync(join(vendor, "node_modules/@paddleocr/paddleocr-js"))) {
  writeFileSync(join(vendor, "package.json"), '{"private":true,"type":"module"}\n');
  sh(
    "npm install --no-audit --no-fund @paddleocr/paddleocr-js@0.4.2 onnxruntime-web@1.18.0 esbuild",
    vendor,
  );
}

writeShim(join(vendor, "node_modules"), "fs", [
  "openSync",
  "closeSync",
  "existsSync",
  "readFileSync",
  "writeFileSync",
  "statSync",
  "mkdirSync",
  "readdirSync",
  "unlinkSync",
  "renameSync",
  "createFileSync",
]);
writeShim(join(vendor, "node_modules"), "path", [
  "join",
  "normalize",
  "resolve",
  "basename",
  "dirname",
  "extname",
  "isAbsolute",
  "sep",
  "delimiter",
]);

const esbuild = join(vendor, "node_modules/esbuild/bin/esbuild");
sh(
  `"${esbuild}" "${loader}" --bundle --format=iife --platform=browser --minify --outfile="${outJs}" --alias:fs=./node_modules/fs.js --alias:path=./node_modules/path.js --alias:@paddleocr/paddleocr-js=./node_modules/@paddleocr/paddleocr-js/dist/index.mjs --alias:onnxruntime-web=./node_modules/onnxruntime-web/dist/esm/ort.wasm.min.js`,
  vendor,
);

const dist = join(vendor, "node_modules/onnxruntime-web/dist");
for (const name of [
  // 1.18 non-threaded SIMD — works without COOP/COEP (Grok preview iframe).
  "ort-wasm-simd.wasm",
  "ort-wasm.wasm",
]) {
  const src = join(dist, name);
  if (!existsSync(src)) {
    console.warn(`[ppocr] missing ${name} in onnxruntime-web`);
    continue;
  }
  copyFileSync(src, join(outOrt, name));
}

console.info("[ppocr] engine bundled → public/ppocr/paddleocr.bundle.js + public/ort/");
