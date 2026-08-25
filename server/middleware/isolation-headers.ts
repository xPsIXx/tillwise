/**
 * CORP so wasm / models can load inside the Grok preview iframe.
 * COOP/COEP are intentionally omitted: credentialless isolation blocks
 * getUserMedia on phones, and PP-OCR runs single-threaded without SAB.
 */
interface IsolationEvent {
  url: URL;
}

export default async function isolationHeadersMiddleware(
  _event: IsolationEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const result = await next();
  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    headers.delete("Cross-Origin-Opener-Policy");
    headers.delete("Cross-Origin-Embedder-Policy");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("Permissions-Policy", "camera=(self), microphone=()");
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
  return result;
}