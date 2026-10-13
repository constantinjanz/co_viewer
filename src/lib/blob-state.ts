import "server-only";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import type { z } from "zod";
import { ApiError } from "./http";

export async function readState<T>(path: string, schema: z.ZodType<T>): Promise<{ value: T; etag: string } | null> {
  // Compression turns Blob's ETag into a weak validator once state grows past
  // the compression threshold. If-Match needs the strong, identity ETag.
  const result = await get(path, { access: "private", useCache: false, headers: { "Accept-Encoding": "identity" }, abortSignal: AbortSignal.timeout(10_000) });
  if (!result) return null;
  if (result.statusCode !== 200) throw new Error("Unexpected state response");
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_000) { await reader.cancel(); throw new Error("Invalid state size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!result.blob.etag || result.blob.etag.startsWith("W/")) throw new Error("Missing strong state version");
  return { value: schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))), etag: result.blob.etag };
}
export async function mutateState<T>(path: string, schema: z.ZodType<T>, initial: () => T, mutation: (before: T) => T | null): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = await readState(path, schema);
    const before = stored?.value ?? initial();
    const next = mutation(before);
    if (next === null) return before;
    try {
      await put(path, JSON.stringify(schema.parse(next)), {
        access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60,
        allowOverwrite: Boolean(stored), ...(stored ? { ifMatch: stored.etag } : {}),
        abortSignal: AbortSignal.timeout(10_000),
      });
      return next;
    } catch (error) {
      const conflict = error instanceof BlobPreconditionFailedError || (error instanceof Error && error.message === "Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.") || (!stored && error instanceof Error && /already exists/i.test(error.message));
      if (!conflict) throw error;
    }
  }
  throw new ApiError(503, "Der Raum wird gerade aktualisiert. Bitte versuche es erneut.");
}
