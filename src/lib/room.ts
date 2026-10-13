import "server-only";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { z } from "zod";
import { MEMBERSHIP_MS, namespace, required } from "./config";
import { readState, mutateState } from "./blob-state";
import { initialState, stateSchema, joinMember, snapshot, applyCommand, leaveMember } from "./room-model";
import type { Membership } from "./auth";
import type { Command, RoomSnapshot } from "./contracts";
import { ApiError } from "./http";

const roomPath = () => `${namespace()}/room.json`;
export async function getRoom(member: Membership): Promise<RoomSnapshot> {
  const now = Date.now();
  const stored = await readState(roomPath(), stateSchema);
  return snapshot(stored?.value ?? initialState(now), member.id, Date.now());
}
export async function enterRoom(member: Membership): Promise<RoomSnapshot> {
  const value = await mutateState(roomPath(), stateSchema, () => initialState(Date.now()), before => joinMember(before, member.id, member.name, Date.now(), member.exp));
  return snapshot(value, member.id, Date.now());
}
export async function updateRoom(member: Membership, command: Command): Promise<RoomSnapshot> {
  const value = await mutateState(roomPath(), stateSchema, () => initialState(Date.now()), before => applyCommand(before, member.id, command, Date.now()));
  return snapshot(value, member.id, Date.now());
}
export async function leaveRoom(member: Membership): Promise<void> {
  await mutateState(roomPath(), stateSchema, () => initialState(Date.now()), before => {
    const now = Date.now();
    // A legacy participant ID may have several renewed tokens. Cover every token
    // issued before this leave, including the verifier's one-minute clock allowance.
    return leaveMember(before, member.id, now, Math.max(member.exp, now + MEMBERSHIP_MS + 60_000));
  });
}
export async function mediaLink(): Promise<{ url: string; expiresAt: number }> {
  const pathname = required("MEDIA_BLOB_PATH");
  if (pathname.includes("://") || !pathname.endsWith(".mp4")) throw new Error("Invalid media configuration");
  const expiresAt = Date.now() + 4 * 60 * 60_000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil: expiresAt, abortSignal: AbortSignal.timeout(10_000) });
  const result = await presignUrl(token, { operation: "get", pathname, access: "private", validUntil: expiresAt });
  return { url: result.presignedUrl, expiresAt };
}
const rateSchema = z.object({ count: z.number().int().nonnegative(), resetAt: z.number().int().nonnegative() });
export async function ensureJoinAllowed(ipHash: string): Promise<void> {
  const record = await readState(`${namespace()}/rate/${ipHash}.json`, rateSchema);
  if (record && record.value.resetAt > Date.now() && record.value.count >= 10) throw new ApiError(429, "Zu viele Versuche. Bitte warte 15 Minuten.");
}
export async function recordWrongJoin(ipHash: string): Promise<void> {
  const record = await mutateState(`${namespace()}/rate/${ipHash}.json`, rateSchema, () => ({ count: 0, resetAt: 0 }), before => {
    const now = Date.now();
    if (before.resetAt > now && before.count >= 10) throw new ApiError(429, "Zu viele Versuche. Bitte warte 15 Minuten.");
    return before.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...before, count: before.count + 1 };
  });
  if (record.count >= 10) throw new ApiError(429, "Zu viele Versuche. Bitte warte 15 Minuten.");
}
