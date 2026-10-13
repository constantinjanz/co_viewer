import { requestMembership } from "@/lib/auth";
import { ApiError, errorResponse, json, readJson, requireOrigin } from "@/lib/http";
import { commandSchema } from "@/lib/room-model";
import { getRoom, updateRoom } from "@/lib/room";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return json(await getRoom(requestMembership(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const member = requestMembership(request);
    const parsed = commandSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Ungültiger Wiedergabebefehl.");
    return json(await updateRoom(member, parsed.data));
  } catch (error) { return errorResponse(error); }
}
