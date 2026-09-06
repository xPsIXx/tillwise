import { handleMediaRequest } from "../../src/lib/media-serve";

interface MediaEvent {
  url: URL;
  req: { method: string };
}

export default async function mediaPhotosMiddleware(
  event: MediaEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  if (!event.url.pathname.startsWith("/media/")) return next();
  const response = await handleMediaRequest(event.url.pathname);
  if (!response) return next();
  if (method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
