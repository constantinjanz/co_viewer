import { type RoomSnapshot } from "./contracts";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly room?: RoomSnapshot) { super(message); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Vary": "Authorization" } });
}
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message, ...(error.room ? { room: error.room } : {}) }, error.status);
  // Provider exceptions can include authorization headers and signed media URLs.
  return json({ error: "Der Raum ist gerade nicht erreichbar. Bitte versuche es gleich erneut." }, 503);
}
export function requireOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "Diese Anfrage ist nicht erlaubt.");
}
export async function requireEmptyBody(request: Request): Promise<void> {
  // Next can expose an empty POST as a readable stream instead of a null body.
  const bytes = await readBody(request);
  if (bytes.byteLength === 0) return;
  requireJsonType(request);
  const value = parseJson(bytes);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new ApiError(400, "Bitte sende eine gültige Anfrage.");
}
function requireJsonType(request: Request): void {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError(415, "Bitte sende eine gültige Anfrage.");
}
function parseJson(bytes: Buffer): unknown {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new ApiError(400, "Bitte sende eine gültige Anfrage."); }
}
export async function readJson(request: Request): Promise<unknown> {
  requireJsonType(request);
  const bytes = await readBody(request);
  if (!bytes.byteLength) throw new ApiError(400, "Die Anfrage ist leer.");
  return parseJson(bytes);
}
async function readBody(request: Request): Promise<Buffer> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) throw new ApiError(413, "Die Anfrage ist zu groß.");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new ApiError(413, "Die Anfrage ist zu groß."); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Bitte sende eine gültige Anfrage.");
  } finally { reader.releaseLock(); }
}
