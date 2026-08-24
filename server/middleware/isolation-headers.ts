/**
 * Cross-origin isolation so ORT/OpenCV pthread wasm can use SharedArrayBuffer
 * when the app is opened as a top-level tab.
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
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
  return result;
}
