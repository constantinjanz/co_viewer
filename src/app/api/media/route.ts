import { requestMembership } from "@/lib/auth";
import { ApiError, errorResponse, json } from "@/lib/http";
import { getRoom, mediaLink } from "@/lib/room";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const member = requestMembership(request);
    const room = await getRoom(member);
    if (!room.members.some(participant => participant.id === member.id)) throw new ApiError(409, "Bitte verbinde dich erneut mit dem Raum.", room);
    return json(await mediaLink());
  } catch (error) { return errorResponse(error); }
}
