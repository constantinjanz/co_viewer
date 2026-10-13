import "server-only";
import { createHash } from "node:crypto";
import type { Film } from "./contracts";

export const MEMBERSHIP_MS = 24 * 60 * 60_000;
export function filmDuration(): number {
  const duration = Number(process.env.MOVIE_DURATION);
  return Number.isFinite(duration) && duration > 0 ? duration : 3600;
}
export function film(): Film {
  return {
    title: process.env.MOVIE_TITLE?.trim().slice(0, 200) || "Privates Video",
    duration: filmDuration(),
    resolution: process.env.MOVIE_RESOLUTION?.trim().slice(0, 30) || "MP4",
    year: process.env.MOVIE_YEAR?.trim().slice(0, 10) || "",
  };
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Missing server configuration");
  return value;
}
export function namespace(): string {
  const environment = process.env.VERCEL_ENV || "development";
  const suffix = environment === "production" ? "production" : `${environment}-${createHash("sha256").update(process.env.VERCEL_URL || "localhost").digest("hex").slice(0, 20)}`;
  return `co-viewer/v1/${suffix}`;
}
export function roomCodeHash(): string {
  const hash = required("ROOM_CODE_HASH").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid server configuration");
  return hash;
}
export function sessionSecret(): Buffer {
  const secret = Buffer.from(required("SESSION_SECRET"), "utf8");
  if (secret.byteLength < 32) throw new Error("Invalid server configuration");
  return secret;
}
