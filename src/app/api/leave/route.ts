import { requestMembership } from "@/lib/auth";
import { errorResponse, json, requireEmptyBody, requireOrigin } from "@/lib/http";
import { leaveRoom } from "@/lib/room";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { requireOrigin(request); const member = requestMembership(request); await requireEmptyBody(request); await leaveRoom(member); return json({ ok: true }); }
  catch (error) { return errorResponse(error); }
}
