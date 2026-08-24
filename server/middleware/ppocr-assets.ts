/**
 * Same-origin Hugging Face proxy on deployed (Nitro) builds.
 * Dev uses the Vite plugin in vite.config.ts against the same helper.
 */
import { handlePpocrApi } from "../../scripts/ppocr-assets.mjs";

interface PpocrEvent {
  url: URL;
  req: { method: string };
}

export default async function ppocrAssetsMiddleware(
  event: PpocrEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  if (event.url.pathname !== "/api/ppocr/hf") return next();

  const response = await handlePpocrApi(event.url);
  if (!response) return next();
  if (method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
