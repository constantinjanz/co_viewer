import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MEMBERSHIP_MS, namespace, roomCodeHash, sessionSecret } from "./config";
import { ApiError } from "./http";

export const nameSchema = z.string().trim().min(1).max(32).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const tokenSchema = z.object({ v: z.literal(1), id: z.uuid(), name: nameSchema, exp: z.number().int().positive(), aud: z.string().max(150), invitation: z.string().length(64) }).strict();
const accessSchema = z.object({ v: z.literal(1), purpose: z.literal("lobby"), id: z.uuid(), exp: z.number().int().positive(), aud: z.string().max(150), invitation: z.string().length(64) }).strict();
export type Membership = z.infer<typeof tokenSchema>;
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]+/g, "");
function equal(a: Buffer, b: Buffer): boolean { return a.length === b.length && timingSafeEqual(a, b); }
export function validCode(code: string): boolean {
  const normalized = normalizeCode(code);
  const digest = createHash("sha256").update(normalized).digest();
  return normalized.length >= 8 && equal(digest, Buffer.from(roomCodeHash(), "hex"));
}
export function issueAccess(now = Date.now()): string {
  const access = { v: 1, purpose: "lobby", id: randomUUID(), exp: now + MEMBERSHIP_MS, aud: namespace(), invitation: roomCodeHash() };
  const payload = Buffer.from(JSON.stringify(access)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
export function verifyAccess(token: string, now = Date.now()): void {
  const unauthorized = () => new ApiError(401, "Bitte gib den Raumcode erneut ein.");
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw unauthorized();
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
  if (!equal(expected, Buffer.from(signature, "base64url"))) throw unauthorized();
  try {
    const access = accessSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (access.exp <= now || access.exp > now + MEMBERSHIP_MS + 60_000 || access.aud !== namespace() || access.invitation !== roomCodeHash()) throw new Error();
  } catch { throw unauthorized(); }
}
export function requestAccess(request: Request): string {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token) throw new ApiError(401, "Bitte gib den Raumcode ein.");
  verifyAccess(token);
  return token;
}
export function issueMembership(name: string, id: string = randomUUID(), now = Date.now()): { token: string; member: Membership } {
  const member: Membership = { v: 1, id, name, exp: now + MEMBERSHIP_MS, aud: namespace(), invitation: roomCodeHash() };
  const payload = Buffer.from(JSON.stringify(member)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, member };
}
export function verifyMembership(token: string, now = Date.now()): Membership {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new ApiError(401, "Bitte tritt dem Raum erneut bei.");
  const [payload, signature] = token.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest();
  if (!equal(expected, Buffer.from(signature, "base64url"))) throw new ApiError(401, "Bitte tritt dem Raum erneut bei.");
  try {
    const member = tokenSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (member.exp <= now || member.exp > now + MEMBERSHIP_MS + 60_000 || member.aud !== namespace() || member.invitation !== roomCodeHash()) throw new Error();
    return member;
  } catch { throw new ApiError(401, "Bitte tritt dem Raum erneut bei."); }
}
export function requestMembership(request: Request): Membership {
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token) throw new ApiError(401, "Bitte tritt dem Raum erneut bei.");
  return verifyMembership(token);
}
export function rateLimitId(request: Request): string {
  const ip = (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "local").split(",")[0].trim().slice(0, 100);
  return createHmac("sha256", sessionSecret()).update(`join:${ip}`).digest("hex");
}
