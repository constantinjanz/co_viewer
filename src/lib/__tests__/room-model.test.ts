import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../contracts";
import { filmDuration } from "../config";
import { initialState, joinMember as enterMember, applyCommand, leaveMember, positionAt, snapshot, stateSchema, MAX_DEPARTURES, type RoomState } from "../room-model";
const joinMember = (state: RoomState, id: string, name: string, now: number, expiresAt = 1_000_000) => enterMember(state, id, name, now, expiresAt);
const a = "b219d8b6-e9c5-4f10-8e96-e8bca92e1a11";
const b = "bfdad0c9-35db-4604-9a97-5bc00c0c9149";
const c = "b62c5840-44b9-468c-8e1a-84f959652dca";
const command = (revision: number, kind: Command["kind"], position: number, id = "command-1", paused = false): Command => ({ commandId: id, kind, position, paused, baseRevision: revision });
beforeEach(() => { vi.stubEnv("MOVIE_DURATION", "3600"); });
describe("authoritative playback", () => {
  it("advances by server time, leaves heartbeat anchor unchanged, and pauses an empty room on rejoin", () => {
    let state = joinMember(initialState(1000), a, "A", 1000);
    state = applyCommand(state, a, command(state.playback.revision, "play", 10), 2000)!;
    const beat = joinMember(state, a, "A", 22_000);
    expect(beat.playback).toEqual(state.playback);
    expect(positionAt(beat.playback, 22_000)).toBe(30);
    const rejoined = joinMember(beat, a, "A", 130_000);
    expect(rejoined.playback.paused).toBe(true);
    expect(rejoined.playback.position).toBe(138);
  });
  it("rejects stale commands and deduplicates retries without rolling back a newer seek", () => {
    let state = joinMember(initialState(0), a, "A", 1000);
    const play = command(state.playback.revision, "play", 10);
    state = applyCommand(state, a, play, 2000)!;
    expect(() => applyCommand(state, a, command(0, "seek", 1, "command-stale"), 3000)).toThrow();
    const seek = command(state.playback.revision, "seek", 200, "command-2", true);
    state = applyCommand(state, a, seek, 3000)!;
    expect(applyCommand(state, a, play, 4000)).toBeNull();
    expect(state.playback.position).toBe(200);
    expect(state.playback.paused).toBe(true);
  });
  it("allows exactly two active members, expires slots, and rejects commands from expired members", () => {
    let state = joinMember(initialState(0), a, "A", 1000);
    state = joinMember(state, b, "B", 2000);
    expect(() => joinMember(state, c, "C", 3000)).toThrow();
    state = joinMember(state, b, "B", 80_000);
    expect(() => applyCommand(state, a, command(state.playback.revision, "play", 0), 92_000)).toThrow();
    state = joinMember(state, c, "C", 92_000);
    expect(snapshot(state, c, 92_000).members.map(member => member.id)).toEqual([b, c]);
    expect(() => joinMember(state, a, "A", 92_001)).toThrow();
  });
  it("leave does not pause playback, and positions stay within the exact film duration", () => {
    let state = joinMember(initialState(0), a, "A", 1000);
    state = applyCommand(state, a, command(state.playback.revision, "play", -20), 2000)!;
    expect(state.playback.position).toBe(0);
    const left = leaveMember(state, a, 2500, 1_000_000)!;
    expect(left.playback).toEqual(state.playback);
    expect(left.members).toEqual([]);
    state = applyCommand(state, a, command(state.playback.revision, "seek", 999999, "command-2"), 3000)!;
    expect(state.playback.position).toBe(filmDuration());
    expect(state.playback.paused).toBe(true);
  });
  it("applies a runtime duration to both state validation and playback bounds", () => {
    vi.stubEnv("MOVIE_DURATION", "240");
    let state = joinMember(initialState(0), a, "A", 1000);
    state = applyCommand(state, a, command(state.playback.revision, "seek", 300), 2000)!;
    expect(state.playback.position).toBe(240);
    expect(state.playback.paused).toBe(true);
    expect(stateSchema.safeParse({ ...state, playback: { ...state.playback, position: 241 } }).success).toBe(false);
  });
  it("reads legacy rooms and preserves ordinary recovery after presence expires", () => {
    const { departures, ...legacy } = initialState(0);
    expect(departures).toEqual([]);
    const state = stateSchema.parse(legacy);
    expect(state.departures).toEqual([]);
    const joined = joinMember(state, a, "A", 1000);
    expect(joinMember(joined, a, "A", 92_000).members[0].id).toBe(a);
  });
  it("revokes departed IDs even if the member was absent and does not alter playback", () => {
    const state = joinMember(initialState(0), b, "B", 1000);
    const left = leaveMember(state, a, 2000, 1_000_000)!;
    expect(left.playback).toEqual(state.playback);
    expect(() => joinMember(left, a, "A", 3000)).toThrowError(/verlassen/);
    expect(leaveMember(left, a, 4000, 1_001_000)).toBeNull();
    expect(joinMember(left, b, "B", 4000).members[0].id).toBe(b);
  });
  it("bounds tombstones without evicting valid revocations and removes only expired ones", () => {
    const state = initialState(0);
    state.departures = Array.from({ length: MAX_DEPARTURES }, (_, index) => ({ id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`, expiresAt: 10_000 }));
    expect(() => leaveMember(state, a, 9999, 20_000)).toThrowError(/später/);
    const left = leaveMember(state, a, 10_000, 20_000)!;
    expect(left.departures).toEqual([{ id: a, expiresAt: 20_000 }]);
    expect(() => joinMember(left, a, "A", 20_000, 20_000)).toThrowError(/abgelaufen/);
    expect(joinMember(left, b, "B", 20_000).departures).toEqual([]);
  });
});
