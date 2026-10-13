import { z } from "zod";
import type { Command, Playback, RoomSnapshot } from "./contracts";
import { filmDuration } from "./config";
import { ApiError } from "./http";

export const ACTIVE_MS = 90_000;
export const MAX_DEPARTURES = 128;
export class MembershipLeftError extends ApiError {
  constructor() { super(401, "Du hast den Raum verlassen. Bitte tritt erneut mit dem Raumcode bei."); }
}
export const commandSchema = z.object({ commandId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), kind: z.enum(["play", "pause", "seek"]), position: z.number().finite(), paused: z.boolean(), baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1) }).strict();
const playbackSchema = z.object({ paused: z.boolean(), position: z.number().finite().min(0).refine(value => value <= filmDuration()), updatedAt: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), actorId: z.string().nullable(), commandId: z.string().nullable() });
export const stateSchema = z.object({
  schema: z.literal(1), playback: playbackSchema,
  members: z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(32), lastSeen: z.number().int().nonnegative() })).max(2),
  receipts: z.array(z.object({ id: z.string().max(100), actorId: z.uuid() })).max(64),
  departures: z.array(z.object({ id: z.uuid(), expiresAt: z.number().int().positive() })).max(MAX_DEPARTURES).default([]),
});
export type RoomState = z.infer<typeof stateSchema>;
export function initialState(now: number): RoomState { return { schema: 1, playback: { paused: true, position: 0, updatedAt: now, revision: 0, actorId: null, commandId: null }, members: [], receipts: [], departures: [] }; }
export function positionAt(playback: Playback, now: number): number { return Math.max(0, Math.min(filmDuration(), playback.position + (playback.paused ? 0 : Math.max(0, now - playback.updatedAt) / 1000))); }
export function activeMembers(state: RoomState, now: number) { return state.members.filter(member => member.lastSeen > now - ACTIVE_MS); }
export function snapshot(state: RoomState, participantId: string, now: number): RoomSnapshot {
  const duration = filmDuration();
  const ended = !state.playback.paused && positionAt(state.playback, now) >= duration;
  return { playback: ended ? { ...state.playback, paused: true, position: duration, updatedAt: now } : state.playback, members: activeMembers(state, now), serverNow: now, participantId };
}
export function joinMember(state: RoomState, id: string, name: string, now: number, membershipExpiresAt: number): RoomState {
  const departures = state.departures.filter(departure => departure.expiresAt > now);
  if (departures.some(departure => departure.id === id)) throw new MembershipLeftError();
  if (membershipExpiresAt <= now) throw new ApiError(401, "Deine Sitzung ist abgelaufen. Bitte tritt erneut bei.");
  const active = activeMembers(state, now);
  const existing = active.find(member => member.id === id);
  if (!existing && active.length >= 2) throw new ApiError(409, "Der Raum ist bereits mit zwei Personen besetzt.", snapshot(state, id, now));
  const playback = active.length === 0 ? { ...state.playback, paused: true, position: positionAt(state.playback, now), updatedAt: now, revision: state.playback.revision + 1, actorId: null, commandId: null } : state.playback;
  return { ...state, playback, members: [...active.filter(member => member.id !== id), { id, name, lastSeen: now }], departures };
}
export function leaveMember(state: RoomState, id: string, now: number, revokedUntil: number): RoomState | null {
  const departures = state.departures.filter(departure => departure.expiresAt > now);
  const alreadyLeft = departures.some(departure => departure.id === id);
  if (alreadyLeft && !state.members.some(member => member.id === id)) return null;
  // Never evict an unexpired revocation: that would let its old token reclaim a seat.
  if (!alreadyLeft && departures.length >= MAX_DEPARTURES) throw new ApiError(503, "Der Raum kann gerade nicht verlassen werden. Bitte versuche es später erneut.");
  return { ...state, members: state.members.filter(member => member.id !== id), departures: alreadyLeft ? departures : [...departures, { id, expiresAt: revokedUntil }] };
}
export function applyCommand(state: RoomState, id: string, command: Command, now: number): RoomState | null {
  if (!activeMembers(state, now).some(member => member.id === id)) throw new ApiError(409, "Bitte verbinde dich erneut mit dem Raum.", snapshot(state, id, now));
  if (state.receipts.some(receipt => receipt.id === command.commandId && receipt.actorId === id)) return null;
  if (command.baseRevision !== state.playback.revision) throw new ApiError(409, "Der Film wurde gerade von der anderen Person gesteuert. Bitte versuche es erneut.", snapshot(state, id, now));
  const duration = filmDuration();
  const position = Math.max(0, Math.min(duration, command.position));
  const paused = position === duration || (command.kind === "seek" ? command.paused : command.kind === "pause");
  return { ...state, playback: { paused, position, updatedAt: now, revision: state.playback.revision + 1, actorId: id, commandId: command.commandId }, receipts: [...state.receipts, { id: command.commandId, actorId: id }].slice(-64) };
}
