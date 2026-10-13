import { z } from "zod";
import { issueAccess, rateLimitId, requestAccess, validCode } from "@/lib/auth";
import { film } from "@/lib/config";
import type { AccessResponse } from "@/lib/contracts";
import { ApiError, errorResponse, json, readJson, requireOrigin } from "@/lib/http";
import { ensureJoinAllowed, recordWrongJoin } from "@/lib/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ code: z.string().min(1).max(128) }).strict();

export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Bitte prüfe den Raumcode.");
    const ipHash = rateLimitId(request);
    await ensureJoinAllowed(ipHash);
    if (!validCode(parsed.data.code)) {
      await recordWrongJoin(ipHash);
      throw new ApiError(401, "Der Raumcode stimmt nicht.");
    }
    const response: AccessResponse = { accessToken: issueAccess(), film: film() };
    return json(response);
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request) {
  try {
    const accessToken = requestAccess(request);
    const response: AccessResponse = { accessToken, film: film() };
    return json(response);
  } catch (error) { return errorResponse(error); }
}
