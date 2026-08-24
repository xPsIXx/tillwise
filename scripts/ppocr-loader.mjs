// esbuild entry: IIFE bundle served from /ppocr/paddleocr.bundle.js
import * as PaddleOCR from "@paddleocr/paddleocr-js";
import * as ort from "onnxruntime-web";

try {
  ort.env.wasm.wasmPaths = "/ort/";
} catch {
  /* older ORT */
}
try {
  ort.env.wasm.numThreads = 1;
} catch {
  /* no COOP/COEP → threaded wasm hangs */
}
try {
  ort.env.wasm.proxy = false;
} catch {
  /* wasm worker proxy also needs isolation headers */
}

globalThis.PaddleOCRJS = PaddleOCR;
globalThis.ort = ort;
globalThis.PaddleOCR = PaddleOCR;
