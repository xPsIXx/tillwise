/**
 * Same-origin Hugging Face proxy for PP-OCRv6. Whitelist only — never an open proxy.
 * Used by the Vite dev middleware and the Nitro deploy middleware.
 */
export const PPOCR_HF = {
  "det-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx",
  "det-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.yml",
  "rec-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx",
  "rec-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.yml",
  "tiny-det-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.onnx",
  "tiny-det-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx/resolve/main/inference.yml",
  "tiny-rec-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.onnx",
  "tiny-rec-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx/resolve/main/inference.yml",
  "small-det-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx",
  "small-det-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.yml",
  "small-rec-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx",
  "small-rec-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.yml",
  "medium-det-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.onnx",
  "medium-det-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.yml",
  "medium-rec-onnx":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx/resolve/main/inference.onnx",
  "medium-rec-yml":
    "https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx/resolve/main/inference.yml",
};

/** @typedef {keyof typeof PPOCR_HF} PpocrKind */

/**
 * @param {string | URL} rawUrl
 * @returns {Promise<Response | null>}
 */
export async function handlePpocrApi(rawUrl) {
  let url;
  try {
    url = typeof rawUrl === "string" ? new URL(rawUrl, "http://local.invalid") : rawUrl;
  } catch {
    return null;
  }
  if (url.pathname !== "/api/ppocr/hf") return null;

  const kind = url.searchParams.get("kind") ?? "";
  const upstreamUrl = Object.hasOwn(PPOCR_HF, kind)
    ? PPOCR_HF[/** @type {keyof typeof PPOCR_HF} */ (kind)]
    : undefined;
  if (!upstreamUrl) {
    return new Response("unknown model file", { status: 404 });
  }

  console.info(`[ppocr] fetching ${kind} from Hugging Face…`);
  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { redirect: "follow" });
  } catch (err) {
    console.error(`[ppocr] Hugging Face fetch failed (${kind}):`, err);
    return new Response("huggingface unreachable", { status: 502 });
  }
  if (!upstream.ok) {
    console.error(`[ppocr] Hugging Face ${kind} → ${upstream.status}`);
    return new Response(`huggingface ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
  const len =
    upstream.headers.get("content-length") || upstream.headers.get("x-linked-size") || "";
  if (len) headers.set("content-length", len);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-ppocr-kind", kind);
  console.info(`[ppocr] ${kind} ok, bytes=${len || "unknown"}`);
  return new Response(upstream.body, { status: 200, headers });
}
