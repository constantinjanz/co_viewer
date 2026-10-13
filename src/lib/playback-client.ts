import type { Playback } from "./contracts";

export function expectedPosition(playback: Playback, serverNow: number, duration = Infinity): number {
  const elapsed = playback.paused ? 0 : Math.max(0, serverNow - playback.updatedAt) / 1000;
  return Math.min(duration, Math.max(0, playback.position + elapsed));
}

export function correctionFor(current: number, expected: number, paused: boolean): { seek: boolean; rate: number } {
  const drift = expected - current;
  if (Math.abs(drift) > 1 || paused && Math.abs(drift) > 0.1) return { seek: true, rate: 1 };
  return { seek: false, rate: Math.abs(drift) > 0.2 && !paused ? (drift > 0 ? 1.03 : 0.97) : 1 };
}

export function clockTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
