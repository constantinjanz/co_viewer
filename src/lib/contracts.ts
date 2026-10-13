export type Film = { title: string; duration: number; resolution: string; year: string };
export type AccessResponse = { accessToken: string; film: Film };
export type Playback = { paused: boolean; position: number; updatedAt: number; revision: number; actorId: string | null; commandId: string | null };
export type RoomSnapshot = { playback: Playback; members: { id: string; name: string; lastSeen: number }[]; serverNow: number; participantId: string };
export type JoinResponse = { token: string; room: RoomSnapshot; media: { url: string; expiresAt: number }; };
export type Command = { commandId: string; kind: "play" | "pause" | "seek"; position: number; paused: boolean; baseRevision: number };
