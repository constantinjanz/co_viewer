import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn() }));
vi.mock("@vercel/blob", () => ({ ...mocks, BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {} }));
import { issueAccess, issueMembership, verifyAccess, verifyMembership, normalizeCode, validCode } from "../auth";
import { mutateState } from "../blob-state";
import { film, filmDuration, namespace } from "../config";
import { initialState, joinMember, stateSchema } from "../room-model";
import { ApiError, readJson } from "../http";
import { POST as join } from "../../app/api/join/route";
import { GET as getAccess, POST as access } from "../../app/api/access/route";
import { GET as getRoom, POST as command } from "../../app/api/room/route";
import { POST as heartbeat } from "../../app/api/heartbeat/route";
import { POST as leave } from "../../app/api/leave/route";
import { GET as media } from "../../app/api/media/route";

const CODE = "ABCDEFGH12345678";
let objects: Map<string, { json: string; etag: string }>;
let writes: number;
function request(path: string, body?: unknown, token?: string, origin = "https://room.example"): Request {
  return new Request(`https://room.example${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "a".repeat(64));
  vi.stubEnv("ROOM_CODE_HASH", createHash("sha256").update(CODE).digest("hex"));
  vi.stubEnv("MEDIA_BLOB_PATH", "private/film.mp4");
  vi.stubEnv("MOVIE_TITLE", "Ein privater Testfilm");
  vi.stubEnv("MOVIE_DURATION", "3600");
  vi.stubEnv("MOVIE_RESOLUTION", "HD");
  vi.stubEnv("MOVIE_YEAR", "2025");
  vi.stubEnv("VERCEL_ENV", "production");
  objects = new Map(); writes = 0;
  vi.clearAllMocks();
  mocks.get.mockImplementation(async (path: string, options?: { headers?: Record<string, string> }) => {
    const object = objects.get(path);
    if (!object) return null;
    const bytes = Buffer.from(object.json);
    const etag = bytes.length >= 1024 && options?.headers?.["Accept-Encoding"] !== "identity" ? `W/${object.etag}` : object.etag;
    return { statusCode: 200, blob: { etag }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  });
  mocks.put.mockImplementation(async (path: string, json: string, options: { allowOverwrite: boolean; ifMatch?: string }) => {
    const before = objects.get(path);
    if ((!options.allowOverwrite && before) || (options.ifMatch && options.ifMatch !== before?.etag)) throw new Error("Vercel Blob: The conditional request cannot succeed due to a conflicting operation against this resource.");
    const etag = `etag-${++writes}`; objects.set(path, { json, etag }); return { etag };
  });
  mocks.issueSignedToken.mockResolvedValue({ token: "scoped-test-token" });
  mocks.presignUrl.mockResolvedValue({ presignedUrl: "https://private.example/film.mp4?test-signature" });
});
describe("private lobby access", () => {
  it("accepts an eight-digit code with its leading zero and revokes previous access", async () => {
    const previousAccess = issueAccess();
    const previousMembership = issueMembership("A").token;
    const numericCode = "01234567";
    vi.stubEnv("ROOM_CODE_HASH", createHash("sha256").update(numericCode).digest("hex"));
    expect(validCode(numericCode)).toBe(true);
    expect(validCode(numericCode.slice(1))).toBe(false);
    expect(validCode("01234568")).toBe(false);
    expect(validCode(CODE)).toBe(false);
    expect(() => verifyAccess(previousAccess)).toThrow();
    expect(() => verifyMembership(previousMembership)).toThrow();
    expect((await access(request("/api/access", { code: numericCode }))).status).toBe(200);
    expect((await access(request("/api/access", { code: CODE }))).status).toBe(401);
  });

  it("reveals no metadata anonymously, with a wrong code, or from a foreign origin", async () => {
    const anonymous = await getAccess(request("/api/access"));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toContain("no-store");
    expect(await anonymous.text()).not.toContain("Testfilm");
    expect((await access(request("/api/access", { code: CODE }, undefined, "https://attacker.example"))).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    const wrong = await access(request("/api/access", { code: "WRONG-1234567890123" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("Testfilm");
  });
  it("issues a lobby token without a seat or media URL, then permits a separate two-person join", async () => {
    const unlocked = await access(request("/api/access", { code: CODE }));
    expect(unlocked.status).toBe(200);
    expect(unlocked.headers.get("cache-control")).toContain("no-store");
    const data = await unlocked.json();
    expect(Object.keys(data).sort()).toEqual(["accessToken", "film"]);
    expect(data.film).toEqual({ title: "Ein privater Testfilm", duration: 3600, resolution: "HD", year: "2025" });
    expect(writes).toBe(0);
    expect(mocks.issueSignedToken).not.toHaveBeenCalled();
    const restored = await getAccess(request("/api/access", undefined, data.accessToken));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual(data);
    const alice = await join(request("/api/join", { accessToken: data.accessToken, name: "Alice" }));
    const bob = await join(request("/api/join", { accessToken: data.accessToken, name: "Bob" }));
    expect(alice.status).toBe(200);
    expect(bob.status).toBe(200);
    expect((await bob.json()).room.members).toHaveLength(2);
    expect((await join(request("/api/join", { accessToken: data.accessToken, name: "Third" }))).status).toBe(409);
    expect((await access(request("/api/access", { code: CODE }))).status).toBe(200);
  });
  it("keeps lobby and membership tokens separate and rejects expired or tampered access", async () => {
    const accessToken = issueAccess();
    expect(() => verifyMembership(accessToken)).toThrow();
    expect(() => verifyAccess(issueMembership("A").token)).toThrow();
    expect((await getRoom(request("/api/room", undefined, accessToken))).status).toBe(401);
    expect((await media(request("/api/media", undefined, accessToken))).status).toBe(401);
    expect((await heartbeat(request("/api/heartbeat", {}, accessToken))).status).toBe(401);
    expect((await command(request("/api/room", { commandId: "forbidden-command", kind: "play", position: 0, paused: false, baseRevision: 0 }, accessToken))).status).toBe(401);
    const expired = issueAccess(Date.now() - 24 * 60 * 60_000);
    expect((await getAccess(request("/api/access", undefined, expired))).status).toBe(401);
    expect((await join(request("/api/join", { accessToken: expired, name: "A" }))).status).toBe(401);
    expect((await getAccess(request("/api/access", undefined, `${accessToken.slice(0, -5)}zzzzz`))).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => verifyAccess(accessToken)).toThrow();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ROOM_CODE_HASH", "b".repeat(64));
    expect(() => verifyAccess(accessToken)).toThrow();
  });
  it("shares wrong-code limits between the gate and legacy join", async () => {
    for (let i = 0; i < 9; i++) expect((await access(request("/api/access", { code: "WRONG-1234567890123" }))).status).toBe(401);
    expect((await join(request("/api/join", { code: "WRONG-1234567890123", name: "A" }))).status).toBe(429);
    expect((await access(request("/api/access", { code: CODE }))).status).toBe(429);
  });
  it("reads server metadata at request time and accepts only a finite positive duration", () => {
    vi.stubEnv("MOVIE_TITLE", "Anderer privater Film");
    vi.stubEnv("MOVIE_DURATION", "123.5");
    expect(film().title).toBe("Anderer privater Film");
    expect(filmDuration()).toBe(123.5);
    for (const value of ["", "0", "-1", "Infinity", "NaN"]) {
      vi.stubEnv("MOVIE_DURATION", value);
      expect(filmDuration()).toBe(3600);
    }
  });
});
describe("membership security", () => {
  it("normalizes high entropy codes, authenticates signatures, and rejects expiry or environment replay", () => {
    expect(normalizeCode("abcd-efgh 1234 5678")).toBe(CODE);
    expect(validCode("abcd-efgh 1234 5678")).toBe(true);
    expect(validCode("wrong")).toBe(false);
    const issued = issueMembership("A");
    expect(verifyMembership(issued.token).id).toBe(issued.member.id);
    expect(() => verifyMembership(`${issued.token.slice(0, -5)}zzzzz`)).toThrow();
    expect(() => verifyMembership(issued.token, issued.member.exp)).toThrow();
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "preview.example");
    expect(namespace()).not.toContain("production");
    expect(() => verifyMembership(issued.token)).toThrow();
  });
  it("enforces origin and bearer checks without touching private state", async () => {
    expect((await join(request("/api/join", { code: CODE, name: "A" }, undefined, "https://attacker.example"))).status).toBe(403);
    expect((await getRoom(request("/api/room"))).status).toBe(401);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("limits chunked oversized JSON even without content-length", async () => {
    await expect(readJson(request("/api/join", { code: "x".repeat(5000) }))).rejects.toMatchObject({ status: 413 });
  });
});
describe("Blob concurrency", () => {
  it("keeps conditional writes working when state grows beyond the compression threshold", async () => {
    const schema = z.object({ count: z.number(), padding: z.string() });
    const initial = () => ({ count: 0, padding: "x".repeat(2048) });
    for (let i = 0; i < 3; i++) await mutateState("large-state", schema, initial, before => ({ ...before, count: before.count + 1 }));
    expect(JSON.parse(objects.get("large-state")!.json).count).toBe(3);
    expect(mocks.get.mock.calls.every(call => call[1].headers["Accept-Encoding"] === "identity")).toBe(true);
  });
  it("uses uncached reads and conditional writes so two racing increments both survive", async () => {
    const schema = z.object({ count: z.number() });
    await Promise.all([1, 2].map(() => mutateState("counter", schema, () => ({ count: 0 }), before => ({ count: before.count + 1 }))));
    expect(JSON.parse(objects.get("counter")!.json)).toEqual({ count: 2 });
    expect(mocks.get.mock.calls.every(call => call[1].useCache === false)).toBe(true);
    expect(mocks.put.mock.calls.some(call => call[2].ifMatch)).toBe(true);
  });
  it("admits only two of three concurrent first joins", async () => {
    const ids = ["b219d8b6-e9c5-4f10-8e96-e8bca92e1a11", "bfdad0c9-35db-4604-9a97-5bc00c0c9149", "b62c5840-44b9-468c-8e1a-84f959652dca"];
    const results = await Promise.allSettled(ids.map(id => mutateState("room", stateSchema, () => initialState(1000), before => joinMember(before, id, id[0], 1000, 100_000))));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(JSON.parse(objects.get("room")!.json).members).toHaveLength(2);
  });
});
describe("private room API", () => {
  it.each([undefined, "", "   "])("accepts optional guest name %j", async name => {
    const joined = await join(request("/api/join", { code: CODE, ...(name === undefined ? {} : { name }) }));
    expect(joined.status).toBe(200);
    expect((await joined.json()).room.members[0].name).toBe("Gast");
  });
  it("joins, serves read-only snapshots, applies commands, rejects stale state, heartbeats and leaves", async () => {
    const gate = await (await access(request("/api/access", { code: CODE }))).json();
    const joined = await join(request("/api/join", { accessToken: gate.accessToken, name: "Alice" }));
    expect(joined.status).toBe(200);
    const data = await joined.json();
    expect(data.media.url).toContain("private.example");
    const count = writes;
    const read = await getRoom(request("/api/room", undefined, data.token));
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect(writes).toBe(count);
    const refreshed = await media(request("/api/media", undefined, data.token));
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).expiresAt).toBeGreaterThan(Date.now() + 3 * 60 * 60_000);
    const action = { commandId: "command-test-1", kind: "play", position: 20, paused: true, baseRevision: data.room.playback.revision };
    const changed = await command(request("/api/room", action, data.token));
    expect(changed.status).toBe(200);
    expect((await changed.json()).playback.paused).toBe(false);
    expect((await command(request("/api/room", action, data.token))).status).toBe(200);
    const stale = await command(request("/api/room", { ...action, commandId: "command-test-2" }, data.token));
    expect(stale.status).toBe(409);
    expect((await stale.json()).room.playback.position).toBe(20);
    expect((await heartbeat(request("/api/heartbeat", {}, data.token))).status).toBe(200);
    expect((await leave(request("/api/leave", {}, data.token))).status).toBe(200);
    const left = await (await getRoom(request("/api/room", undefined, data.token))).json();
    expect(left.members).toHaveLength(0);
    expect(left.playback.paused).toBe(false);
    expect((await media(request("/api/media", undefined, data.token))).status).toBe(409);
  });
  it("rejects unexpected or oversized heartbeat and leave payloads", async () => {
    const token = issueMembership("A").token;
    expect((await heartbeat(request("/api/heartbeat", { unwanted: true }, token))).status).toBe(400);
    expect((await leave(request("/api/leave", { junk: "x".repeat(5000) }, token))).status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("accepts browser empty POST streams for heartbeat and leave without a JSON content type", async () => {
    const data = await (await join(request("/api/join", { code: CODE, name: "Alice" }))).json();
    const emptyPost = (path: string) => new Request(`https://room.example${path}`, {
      method: "POST", headers: { origin: "https://room.example", authorization: `Bearer ${data.token}`, "content-length": "0" },
      body: new ReadableStream({ start(controller) { controller.close(); } }), duplex: "half",
    } as RequestInit & { duplex: "half" });
    const refreshed = await heartbeat(emptyPost("/api/heartbeat"));
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).participantId).toBe(data.room.participantId);
    expect((await leave(emptyPost("/api/leave"))).status).toBe(200);
    expect((await media(request("/api/media", undefined, data.token))).status).toBe(409);
  });
  it("rejects an in-flight heartbeat after leave commits and gives an explicit rejoin a fresh identity", async () => {
    const alice = await (await join(request("/api/join", { code: CODE, name: "Alice" }))).json();
    const bob = await (await join(request("/api/join", { code: CODE, name: "Bob" }))).json();
    const recovered = await heartbeat(request("/api/heartbeat", {}, alice.token));
    expect((await recovered.json()).participantId).toBe(alice.room.participantId);
    const playing = await command(request("/api/room", { commandId: "race-play-1", kind: "play", position: 30, paused: false, baseRevision: bob.room.playback.revision }, bob.token));
    expect(playing.status).toBe(200);
    const expectedPlayback = (await playing.json()).playback;

    let releaseWrite!: () => void;
    let markReadComplete!: () => void;
    const heldWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
    const heartbeatReadComplete = new Promise<void>(resolve => { markReadComplete = resolve; });
    const normalPut = mocks.put.getMockImplementation()!;
    mocks.put.mockImplementationOnce(async (...args) => {
      markReadComplete();
      await heldWrite;
      return normalPut(...args);
    });
    const lateHeartbeat = heartbeat(request("/api/heartbeat", {}, alice.token));
    await heartbeatReadComplete;
    try { expect((await leave(request("/api/leave", {}, alice.token))).status).toBe(200); }
    finally { releaseWrite(); }
    expect((await lateHeartbeat).status).toBe(401);
    const after = await (await getRoom(request("/api/room", undefined, bob.token))).json();
    expect(after.members.map((member: { id: string }) => member.id)).toEqual([bob.room.participantId]);
    expect(after.playback).toEqual(expectedPlayback);
    const stored = JSON.parse(objects.get(`${namespace()}/room.json`)!.json);
    expect(stored.departures[0].expiresAt).toBeGreaterThanOrEqual(verifyMembership(alice.token).exp);

    const rejoined = await join(request("/api/join", { code: CODE, name: "Alice", resumeToken: alice.token }));
    expect(rejoined.status).toBe(200);
    const fresh = await rejoined.json();
    expect(fresh.room.participantId).not.toBe(alice.room.participantId);
    expect((await heartbeat(request("/api/heartbeat", {}, alice.token))).status).toBe(401);
    expect((await heartbeat(request("/api/heartbeat", {}, fresh.token))).status).toBe(200);
  });
  it("persists wrong-code rate limits and suppresses provider details", async () => {
    for (let i = 0; i < 9; i++) expect((await join(request("/api/join", { code: "WRONG-1234567890123", name: "A" }))).status).toBe(401);
    expect((await join(request("/api/join", { code: "WRONG-1234567890123", name: "A" }))).status).toBe(429);
    expect((await join(request("/api/join", { code: CODE, name: "A" }))).status).toBe(429);
    mocks.get.mockRejectedValue(new Error("Bearer SECRET https://private.example/?token=SECRET"));
    const failure = await getRoom(request("/api/room", undefined, issueMembership("A").token));
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("SECRET");
  });
});
