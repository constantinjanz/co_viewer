import { requestMembership } from "@/lib/auth";
import { errorResponse, json, requireEmptyBody, requireOrigin } from "@/lib/http";
import { enterRoom } from "@/lib/room";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { requireOrigin(request); const member = requestMembership(request); await requireEmptyBody(request); return json(await enterRoom(member)); }
  catch (error) { return errorResponse(error); }
}
