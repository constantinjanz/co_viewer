import { z } from "zod";
import { issueMembership, nameSchema, rateLimitId, validCode, verifyAccess, verifyMembership } from "@/lib/auth";
import { ApiError, errorResponse, json, readJson, requireOrigin } from "@/lib/http";
import { ensureJoinAllowed, enterRoom, mediaLink, recordWrongJoin } from "@/lib/room";
import { MembershipLeftError } from "@/lib/room-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ accessToken: z.string().min(1).max(2048).optional(), code: z.string().min(1).max(128).optional(), name: z.preprocess(value => value === undefined || (typeof value === "string" && !value.trim()) ? "Gast" : value, nameSchema), resumeToken: z.string().max(2048).optional() }).strict().refine(value => Boolean(value.accessToken) !== Boolean(value.code));
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Bitte prüfe den Raumcode und deinen Namen.");
    if (parsed.data.accessToken) verifyAccess(parsed.data.accessToken);
    else {
      const ipHash = rateLimitId(request);
      await ensureJoinAllowed(ipHash);
      if (!validCode(parsed.data.code!)) { await recordWrongJoin(ipHash); throw new ApiError(401, "Der Raumcode stimmt nicht."); }
    }
    let id: string | undefined;
    if (parsed.data.resumeToken) { try { id = verifyMembership(parsed.data.resumeToken).id; } catch { /* Valid invitation permits fresh membership. */ } }
    let issued = issueMembership(parsed.data.name, id);
    const media = await mediaLink();
    let room;
    try { room = await enterRoom(issued.member); }
    catch (error) {
      if (!(error instanceof MembershipLeftError) || !id) throw error;
      // A fresh authenticated join must not revive the departed token's ID.
      issued = issueMembership(parsed.data.name);
      room = await enterRoom(issued.member);
    }
    return json({ token: issued.token, room, media });
  } catch (error) { return errorResponse(error); }
}
