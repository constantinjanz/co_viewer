"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type SVGProps } from "react";
import type { AccessResponse, Film, Command, JoinResponse, RoomSnapshot } from "@/lib/contracts";
import { clockTime, correctionFor, expectedPosition } from "@/lib/playback-client";

const SESSION_KEY = "co-viewer:session:v2";
const ACCESS_KEY = "co-viewer:access:v1";
type Media = JoinResponse["media"];
type Connection = "connecting" | "online" | "reconnecting" | "offline";
class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, token?: string, options: RequestInit = {}): Promise<{ data: T; startedAt: number }> {
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(15_000);
  const result = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const data = await result.json().catch(() => null);
  if (!result.ok) throw new ApiError(data?.error || "Die Anfrage konnte nicht abgeschlossen werden.", result.status);
  return { data: data as T, startedAt };
}
function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : "Die Verbindung wurde unterbrochen. Bitte versuche es erneut.";
}
function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: "play" | "pause" | "volume" | "muted" | "fullscreen" | "arrow" | "link" | "close" }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M7 5h4v14H7zm7 0h4v14h-4z" fill="currentColor" stroke="none" /></>,
    volume: <><path d="m11 5-5 4H3v6h3l5 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="m11 5-5 4H3v6h3l5 4Zm5 4 6 6m0-6-6 6" /></>,
    fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    link: <><path d="m9 15 6-6m-7 8-1 1a4.2 4.2 0 0 1-6-6l5-5a4.2 4.2 0 0 1 6 0m0 0 1-1a4.2 4.2 0 0 1 6 6l-5 5a4.2 4.2 0 0 1-6 0" transform="translate(2 0) scale(.95)" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export default function Viewer() {
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [film, setFilm] = useState<Film | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [canRestore, setCanRestore] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const roomRef = useRef<RoomSnapshot | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const mediaRef = useRef<Media | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const lastSuccess = useRef(0);
  const serverOffset = useRef(0);
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingCommands = useRef(0);
  const seekDraftRef = useRef<number | null>(null);
  const autoplayBlockedRef = useRef(false);
  const playAttempt = useRef(false);
  const mediaRefreshing = useRef(false);

  const clearSession = useCallback((notice?: string) => {
    tokenRef.current = null;
    roomRef.current = null;
    mediaRef.current = null;
    videoRef.current?.pause();
    setToken(null); setRoom(null); setMedia(null); setReady(false); setPosition(0);
    setAutoplayBlocked(false); autoplayBlockedRef.current = false;
    setCanRestore(false);
    setError(notice || null);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Memory session still works. */ }
  }, []);

  const clearAccess = useCallback((notice?: string) => {
    clearSession(notice);
    setAccessToken(null); setFilm(null); setCode("");
    try { sessionStorage.removeItem(ACCESS_KEY); } catch { /* Memory access is already cleared. */ }
  }, [clearSession]);

  const receiveAccess = useCallback((data: AccessResponse) => {
    setAccessToken(data.accessToken); setFilm(data.film); setDuration(data.film.duration);
    try { sessionStorage.setItem(ACCESS_KEY, data.accessToken); } catch { /* Current tab remains usable. */ }
  }, []);

  const receive = useCallback((snapshot: RoomSnapshot, startedAt: number) => {
    const previous = roomRef.current;
    lastSuccess.current = Date.now();
    setConnection("online");
    const freshPresence = !previous || snapshot.serverNow >= previous.serverNow;
    if (freshPresence) serverOffset.current = snapshot.serverNow - (startedAt + Date.now()) / 2;
    const playback = previous && snapshot.playback.revision < previous.playback.revision ? previous.playback : snapshot.playback;
    const next = { ...(freshPresence ? snapshot : previous!), playback };
    roomRef.current = next;
    setRoom(next);
  }, []);

  const changeMedia = useCallback((next: Media) => {
    mediaRef.current = next;
    setMedia(next);
    setReady(false);
    setMediaError(null);
  }, []);

  const syncVideo = useCallback(() => {
    const video = videoRef.current;
    const snapshot = roomRef.current;
    if (!video || !snapshot || !tokenRef.current) return;
    if (Date.now() - lastSuccess.current > 10_000) {
      video.pause();
      video.playbackRate = 1;
      setConnection("offline");
      return;
    }
    if (video.readyState < 1 || pendingCommands.current > 0 || seekDraftRef.current !== null) return;
    const target = expectedPosition(snapshot.playback, Date.now() + serverOffset.current, Number.isFinite(video.duration) ? video.duration : (film?.duration || 0));
    const correction = correctionFor(video.currentTime, target, snapshot.playback.paused);
    if (correction.seek) video.currentTime = target;
    video.playbackRate = correction.rate;
    if (snapshot.playback.paused) {
      video.pause();
      autoplayBlockedRef.current = false;
      setAutoplayBlocked(false);
    } else if (video.paused && !video.ended && !playAttempt.current && !autoplayBlockedRef.current) {
      playAttempt.current = true;
      void video.play().catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === "NotAllowedError") {
          autoplayBlockedRef.current = true;
          setAutoplayBlocked(true);
        }
      }).finally(() => { playAttempt.current = false; });
    }
  }, [film?.duration]);

  const refreshMedia = useCallback(async (signal?: AbortSignal) => {
    const activeToken = tokenRef.current;
    if (!activeToken || mediaRefreshing.current) return;
    mediaRefreshing.current = true;
    try {
      const result = await request<Media>("/api/media", activeToken, { signal });
      if (!signal?.aborted && tokenRef.current === activeToken) changeMedia(result.data);
    } catch (failure) {
      if (signal?.aborted || tokenRef.current !== activeToken) return;
      if (failure instanceof ApiError && failure.status === 401) clearSession("Deine Sitzung ist abgelaufen. Bitte tritt dem Raum erneut bei.");
      else setMediaError(errorText(failure));
    } finally { mediaRefreshing.current = false; }
  }, [changeMedia, clearSession]);

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      setLoading(true);
      let saved: string | null = null;
      let savedAccess: string | null = null;
      try { saved = sessionStorage.getItem(SESSION_KEY); savedAccess = sessionStorage.getItem(ACCESS_KEY); } catch { /* Start without saved access. */ }
      if (!savedAccess) { setLoading(false); return; }
      try {
        const access = await request<AccessResponse>("/api/access", savedAccess, { signal: controller.signal });
        if (controller.signal.aborted) return;
        receiveAccess(access.data);
      } catch (failure) {
        if (!controller.signal.aborted) { clearAccess(errorText(failure)); setLoading(false); }
        return;
      }
      if (!saved) { setLoading(false); return; }
      try {
        // Reclaim the existing participant before loading media; expired presence may
        // have freed the seat for somebody else while this tab was closed.
        await request<RoomSnapshot>("/api/heartbeat", saved, { method: "POST", signal: controller.signal });
        const [snapshot, source] = await Promise.all([
          request<RoomSnapshot>("/api/room", saved, { signal: controller.signal }),
          request<Media>("/api/media", saved, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        tokenRef.current = saved; setToken(saved);
        receive(snapshot.data, snapshot.startedAt); changeMedia(source.data);
        setCanRestore(false); setError(null);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 401) clearSession("Deine Sitzung ist abgelaufen. Bitte tritt dem Raum erneut bei.");
        else { setError(errorText(failure)); setCanRestore(true); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void restore();
    return () => controller.abort();
  }, [changeMedia, clearAccess, clearSession, receiveAccess, receive, restoreAttempt]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let heartbeatAt = Date.now();
    async function poll() {
      try {
        const heartbeat = Date.now() - heartbeatAt >= 20_000;
        const result = await request<RoomSnapshot>(heartbeat ? "/api/heartbeat" : "/api/room", token!, { method: heartbeat ? "POST" : "GET", signal: controller.signal });
        if (controller.signal.aborted || tokenRef.current !== token) return;
        if (heartbeat) heartbeatAt = Date.now();
        receive(result.data, result.startedAt);
      } catch (failure) {
        if (controller.signal.aborted || tokenRef.current !== token) return;
        if (failure instanceof ApiError && failure.status === 401) { clearSession("Deine Sitzung ist abgelaufen. Bitte tritt dem Raum erneut bei."); return; }
        if (failure instanceof ApiError && failure.status === 409) { clearSession(errorText(failure)); return; }
        setConnection(Date.now() - lastSuccess.current > 10_000 ? "offline" : "reconnecting");
      } finally {
        if (!controller.signal.aborted && tokenRef.current === token) timer = setTimeout(poll, (roomRef.current?.members.length || 0) >= 2 ? 2_000 : 5_000);
      }
    }
    timer = setTimeout(poll, 2_000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, clearSession, receive]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (mediaRef.current && mediaRef.current.expiresAt - Date.now() < 15 * 60_000) void refreshMedia(controller.signal);
    }, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [token, refreshMedia]);

  useEffect(() => {
    if (!token) return;
    syncVideo();
    const timer = setInterval(syncVideo, 500);
    return () => clearInterval(timer);
  }, [token, room, ready, syncVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  }, [volume, muted, media]);

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unlocking || loading) return;
    setUnlocking(true); setError(null);
    try {
      const result = await request<AccessResponse>("/api/access", undefined, { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      receiveAccess(result.data); setCode("");
    } catch (failure) { setError(errorText(failure)); }
    finally { setUnlocking(false); }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining || !accessToken) return;
    setJoining(true); setError(null);
    try {
      let resumeToken: string | undefined;
      try { resumeToken = sessionStorage.getItem(SESSION_KEY) || undefined; } catch { /* Optional. */ }
      const result = await request<JoinResponse>("/api/join", undefined, { method: "POST", body: JSON.stringify({ accessToken, name: name.trim(), resumeToken }) });
      tokenRef.current = result.data.token; setToken(result.data.token);
      receive(result.data.room, result.startedAt); changeMedia(result.data.media);
      setCanRestore(false);
      try { sessionStorage.setItem(SESSION_KEY, result.data.token); } catch { /* Current tab remains usable. */ }
      setCode("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) clearAccess(errorText(failure));
      else setError(errorText(failure));
    }
    finally { setJoining(false); }
  }

  function sendCommand(kind: Command["kind"], targetPosition?: number) {
    const activeToken = tokenRef.current;
    const snapshot = roomRef.current;
    const video = videoRef.current;
    if (!activeToken || !snapshot || !video || video.readyState < 1 || pendingCommands.current > 0 || Date.now() - lastSuccess.current > 10_000) return;
    const desiredPosition = Math.max(0, Math.min(duration, targetPosition ?? video.currentTime));
    const paused = kind === "play" ? false : kind === "pause" ? true : snapshot.playback.paused;
    pendingCommands.current += 1;
    setBusy(true); setError(null);
    // Only explicit user actions enter this path. Native video events never send commands.
    if (kind === "play") {
      autoplayBlockedRef.current = false; setAutoplayBlocked(false);
      void video.play().catch(() => { autoplayBlockedRef.current = true; setAutoplayBlocked(true); });
    } else if (kind === "pause") video.pause();
    if (kind === "seek") { video.currentTime = desiredPosition; setPosition(desiredPosition); }
    commandQueue.current = commandQueue.current.then(async () => {
      try {
        if (tokenRef.current !== activeToken) return;
        const result = await request<RoomSnapshot>("/api/room", activeToken, { method: "POST", body: JSON.stringify({ commandId: crypto.randomUUID(), kind, position: desiredPosition, paused, baseRevision: roomRef.current!.playback.revision } satisfies Command) });
        if (tokenRef.current === activeToken) receive(result.data, result.startedAt);
      } catch (failure) {
        if (tokenRef.current !== activeToken) return;
        if (failure instanceof ApiError && failure.status === 401) { clearSession("Deine Sitzung ist abgelaufen. Bitte tritt dem Raum erneut bei."); return; }
        setError(failure instanceof ApiError && failure.status === 409 ? "Ihr habt gleichzeitig gesteuert. Der gemeinsame Stand wurde übernommen. Bitte versuche es noch einmal." : errorText(failure));
        try {
          const latest = await request<RoomSnapshot>("/api/room", activeToken);
          if (tokenRef.current === activeToken) receive(latest.data, latest.startedAt);
        } catch { setConnection("reconnecting"); }
      } finally {
        pendingCommands.current -= 1; setBusy(false); syncVideo();
      }
    });
  }

  function commitSeek() {
    const target = seekDraftRef.current;
    seekDraftRef.current = null; setSeekDraft(null);
    if (target !== null) sendCommand("seek", target);
  }

  function allowPlayback() {
    const video = videoRef.current;
    const snapshot = roomRef.current;
    if (!video || !snapshot || snapshot.playback.paused || Date.now() - lastSuccess.current > 10_000) return;
    video.currentTime = expectedPosition(snapshot.playback, Date.now() + serverOffset.current, duration);
    autoplayBlockedRef.current = false; setAutoplayBlocked(false);
    void video.play().catch(() => { autoplayBlockedRef.current = true; setAutoplayBlocked(true); });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen();
      else (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
    } catch { setError("Vollbild ist in diesem Browser gerade nicht verfügbar."); }
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if ([" ", "k", "ArrowLeft", "ArrowRight", "m", "f"].includes(event.key)) event.preventDefault();
    if (event.key === " " || event.key === "k") sendCommand(roomRef.current?.playback.paused ? "play" : "pause");
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") sendCommand("seek", (videoRef.current?.currentTime || 0) + (event.key === "ArrowLeft" ? -5 : 5));
    if (event.key === "m") setMuted(value => !value);
    if (event.key === "f") void toggleFullscreen();
  }

  async function retryConnection() {
    const activeToken = tokenRef.current;
    if (!activeToken) return;
    setConnection("connecting");
    try {
      const result = await request<RoomSnapshot>("/api/heartbeat", activeToken, { method: "POST" });
      if (tokenRef.current === activeToken) { receive(result.data, result.startedAt); setError(null); }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) clearSession("Deine Sitzung ist abgelaufen. Bitte tritt dem Raum erneut bei.");
      else { setError(errorText(failure)); setConnection("offline"); }
    }
  }

  async function leave() {
    const activeToken = tokenRef.current;
    if (!activeToken || leaving) return;
    setLeaving(true);
    try {
      await request("/api/leave", activeToken, { method: "POST" });
      clearSession();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) clearSession();
      else setError(errorText(failure));
    } finally { setLeaving(false); }
  }

  const joined = token !== null && room !== null;
  const offline = connection === "offline";
  const paused = room?.playback.paused ?? true;
  const controlsDisabled = !ready || busy || offline || leaving;
  const other = room?.members.find(member => member.id !== room.participantId);
  const shownPosition = seekDraft ?? position;

  if (loading || !accessToken || !film) return <main className="access-screen">
    <form className="access-form" onSubmit={unlock} aria-label="Raum öffnen">
      <label className="sr-only" htmlFor="room-code">Raumcode</label>
      <div className="access-entry"><input id="room-code" type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Raumcode" required maxLength={128} disabled={loading || unlocking} aria-describedby={error ? "access-error" : undefined} autoFocus /><button type="submit" aria-label={loading || unlocking ? "Raum wird geöffnet" : "Raum öffnen"} disabled={loading || unlocking}>{loading || unlocking ? <span className="spinner" /> : <Icon name="arrow" />}</button></div>
      {error ? <p id="access-error" role="alert">{error}</p> : null}
    </form>
  </main>;

  return <div className={`site-shell ${joined ? "in-room" : "in-lobby"}`}>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Zusammen – Startseite"><span className="brand-symbol" aria-hidden="true"><i /><i /></span>zusammen<span>.</span></a>
      <span className="private-tag"><span />Privater Filmabend</span>
    </header>

    {!joined ? <main className="lobby">
      <div className="lobby-heading"><p className="eyebrow">ZWEI PLÄTZE. EIN FILM.</p><h1>Gleicher Film.<br /><span>Gleicher Moment.</span></h1><p>Zusammen schauen. Auch wenn ihr gerade<br className="desktop-break" /> nicht am selben Ort seid.</p></div>
      <div className="lobby-grid">
        <div className="film-cover" aria-label={`${film.title}, euer Film heute Abend`}><div className="cover-top"><span>HEUTE IM PRIVATKINO</span><span className="cover-star" aria-hidden="true">✳</span></div><div className="cover-title"><strong>{film.title}</strong></div><div className="cover-bottom"><span>Euer gemeinsamer Filmabend.</span><span>{clockTime(film.duration)}</span></div></div>
        <form className="join-card" onSubmit={join}>
          <div className="join-heading"><span className="seat-icon" aria-hidden="true">02</span><h2>Nimm Platz.</h2><p>Euer privater Raum ist geöffnet.</p></div>
          <label htmlFor="name">Dein Name <span>optional</span></label><input id="name" value={name} onChange={event => setName(event.target.value)} autoComplete="given-name" placeholder="Wie heißt du?" maxLength={32} disabled={joining} />
          {error ? <p id="join-error" className="feedback error-feedback" role="alert">{error}</p> : null}
          {canRestore ? <button className="restore-button" type="button" onClick={() => setRestoreAttempt(value => value + 1)}>Gespeicherte Sitzung erneut verbinden</button> : null}
          <button className="primary-button" type="submit" disabled={joining}>{joining ? <><span className="spinner" />Dein Platz wird reserviert …</> : <>Filmabend beitreten<Icon name="arrow" /></>}</button>
          <p id="code-hint" className="join-note">Zwei Personen. Gemeinsame Wiedergabe.<br />Kein Konto nötig.</p>
          <button className="restore-button logout-button" type="button" onClick={() => clearAccess()} disabled={joining}>Abmelden</button>
        </form>
      </div>
      <div className="lobby-caption"><span><i />Für euren gemeinsamen Moment</span><span>Ton an. Alltag aus.</span></div>
    </main> : <main className="watch-room">
      <div className="film-heading"><div><p className="eyebrow">EUER FILMABEND</p><h1>{film.title}</h1><p>{film.resolution}<span>·</span>{Math.round(film.duration / 60)} Minuten<span>·</span>Gemeinsam ansehen</p></div><div className="presence" aria-label="Personen im Raum"><div className="avatars">{room.members.map((member, index) => <span className={`avatar avatar-${index}`} key={member.id} title={`${member.name}${member.id === room.participantId ? " (du)" : ""}`}>{member.name.slice(0, 1).toUpperCase() || "?"}</span>)}{room.members.length < 2 ? <span className="avatar empty-avatar" aria-hidden="true">+</span> : null}</div><div><strong>{room.members.length} von 2 da</strong><span>{other ? `${other.name} ist dabei` : "Ein Platz ist noch frei"}</span></div></div></div>

      {connection !== "online" ? <div className={`connection-banner ${offline ? "is-offline" : ""}`} role="status"><span>{offline ? "Verbindung unterbrochen. Dein Film pausiert, bis ihr wieder synchron seid." : "Verbindung wird wiederhergestellt …"}</span>{offline ? <button type="button" onClick={() => { void retryConnection(); }}>Erneut verbinden</button> : null}</div> : null}

      <div className="cinema-player" ref={playerRef} tabIndex={0} onKeyDown={keyboard} aria-label="Filmplayer. Leertaste für Wiedergabe, Pfeiltasten zum Spulen, F für Vollbild.">
        <div className="video-stage">
          <video ref={videoRef} src={media?.url} preload="metadata" playsInline controls={false} onLoadedMetadata={() => { const video = videoRef.current; if (video && Number.isFinite(video.duration)) setDuration(video.duration); setReady(true); setMediaError(null); syncVideo(); }} onTimeUpdate={() => setPosition(videoRef.current?.currentTime || 0)} onWaiting={() => setBuffering(true)} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)} onError={() => setMediaError("Der Film konnte gerade nicht geladen werden. Bitte lade ihn erneut.")} />
          {!ready && !mediaError ? <div className="screen-overlay loading-overlay"><span className="spinner" /><p>Der Film wird geladen …</p></div> : null}
          {mediaError ? <div className="screen-overlay"><p>{mediaError}</p><button className="overlay-button" type="button" onClick={() => { void refreshMedia(); }}>Film erneut laden<Icon name="arrow" /></button></div> : null}
          {ready && autoplayBlocked && !paused && !offline && !mediaError ? <div className="screen-overlay autoplay-overlay"><button className="overlay-button" type="button" onClick={allowPlayback}><Icon name="play" />Wiedergabe erlauben</button><p>Ein Klick verbindet dich mit dem laufenden Film.</p></div> : null}
          {ready && paused && !mediaError && !offline ? <button className="screen-play" type="button" aria-label="Film für beide starten" onClick={() => sendCommand("play")} disabled={controlsDisabled}><Icon name="play" /></button> : null}
          {buffering && ready && !paused && !autoplayBlocked && !mediaError ? <span className="buffering-indicator" role="status"><span className="spinner" /><span className="sr-only">Film lädt nach</span></span> : null}
        </div>
        <div className="transport-controls">
          <input className="timeline" type="range" min={0} max={duration} step={0.1} value={shownPosition} style={{ "--played": `${Math.min(100, shownPosition / duration * 100)}%` } as CSSProperties} aria-label="Gemeinsame Filmposition" aria-valuetext={`${clockTime(shownPosition)} von ${clockTime(duration)}`} disabled={controlsDisabled} onChange={event => { const value = Number(event.target.value); seekDraftRef.current = value; setSeekDraft(value); }} onPointerUp={commitSeek} onPointerCancel={() => { seekDraftRef.current = null; setSeekDraft(null); }} onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commitSeek(); }} onBlur={commitSeek} />
          <div className="transport-row"><div className="transport-left"><button className="icon-button play-control" type="button" aria-label={paused ? "Für beide abspielen" : "Für beide pausieren"} disabled={controlsDisabled} onClick={() => sendCommand(paused ? "play" : "pause")}><Icon name={paused ? "play" : "pause"} /></button><span className="time-display"><strong>{clockTime(shownPosition)}</strong><span>/</span>{clockTime(duration)}</span></div><div className="transport-right"><span className={`sync-pill ${connection !== "online" ? "sync-pending" : ""}`}><i />{connection === "online" ? "Synchron" : "Verbinden"}</span><div className="volume-controls"><button className="icon-button" type="button" aria-label={muted ? "Ton einschalten" : "Ton ausschalten"} onClick={() => setMuted(value => !value)}><Icon name={muted || volume === 0 ? "muted" : "volume"} /></button><input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Deine Lautstärke" onChange={event => { setVolume(Number(event.target.value)); setMuted(false); }} /></div><button className="icon-button" type="button" aria-label={fullscreen ? "Vollbild beenden" : "Vollbild"} onClick={() => { void toggleFullscreen(); }}><Icon name="fullscreen" /></button></div></div>
        </div>
      </div>

      {error ? <div className="feedback room-feedback" role="alert"><span>{error}</span><button className="icon-button" type="button" aria-label="Meldung schließen" onClick={() => setError(null)}><Icon name="close" /></button></div> : null}
      <div className="room-bottom"><div className="room-explanation"><span className="shared-icon"><Icon name="link" /></span><div><strong>{other ? "Ihr schaut zusammen." : "Dein Filmabend ist bereit."}</strong><p>{other ? "Abspielen, Pausieren und Spulen gelten für euch beide." : "Teile euren Raumcode. Die zweite Person kann direkt einsteigen."}</p></div></div><button className="leave-button" type="button" onClick={() => { void leave(); }} disabled={leaving || busy}>{leaving ? "Raum wird verlassen …" : "Raum verlassen"}<Icon name="arrow" /></button></div>
      <p className="local-note">Lautstärke und Vollbild sind nur für dich. Beim Verlassen läuft der Film für die andere Person weiter.</p>
    </main>}
    <footer className="site-footer"><span>Ein bisschen näher. Ein Film lang.</span><span>ZUSAMMEN / PRIVATKINO</span></footer>
  </div>;
}
