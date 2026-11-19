"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown, ListMusic, Pause, Play, Repeat, Repeat1,
  SkipBack, SkipForward, Shuffle, Volume2, VolumeX, X, AlertCircle, LoaderCircle
} from "lucide-react";
import { useLanguage } from "./language-provider";
import { useAuth } from "./auth-provider";

export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  artworkUrl: string | null;
  audioUrl: string;
  licenseUrl: string;
  sourceUrl: string;
};

type RepeatMode = "off" | "all" | "one";
type PlayerContextValue = {
  currentTrack: PlayerTrack | null;
  isPlaying: boolean;
  playTrack: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  togglePlay: () => void;
};
const PlayerContext = createContext<PlayerContextValue | null>(null);
const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside PlayerProvider");
  return value;
}

function timeLabel(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function mediaErrorMessage(code: number | undefined, t: (value: string) => string) {
  switch (code) {
    case 1: return t("Playback was interrupted. Press play to try again.");
    case 2: return t("Network error while loading this track. Check your connection.");
    case 3: return t("This audio stream could not be decoded by the browser.");
    case 4: return t("This track is unavailable from its provider or its format is unsupported.");
    default: return t("This track could not be played. Try another source.");
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<PlayerTrack | null>(null);
  const fallbackAttemptsRef = useRef<Set<string>>(new Set());
  const tokenRef = useRef("");
  const { accessToken } = useAuth();
  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [playbackMode, setPlaybackMode] = useState<"original" | "speed" | "slowed">("original");
  const [playerSettingsReady, setPlayerSettingsReady] = useState(false);
  const { t } = useLanguage();

  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);

  async function recordEvent(track: PlayerTrack, eventType: "play" | "complete" | "skip", listenedMs: number) {
    const token = tokenRef.current;
    // Provider history currently accepts Jamendo IDs only. Other providers still play normally.
    if (!token) return;
    const providerTrackId = track.id.startsWith("jamendo:") ? track.id.slice("jamendo:".length) : track.id;
    if (!/^[0-9]{1,24}$/.test(providerTrackId)) return;
    try {
      await fetch(`${API}/api/v1/provider-history`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerTrackId, title: track.title, artistName: track.artist,
          albumName: track.album, durationSeconds: Math.max(1, Math.round(track.durationSeconds || 1)),
          artworkUrl: track.artworkUrl, licenseUrl: track.licenseUrl, sourceUrl: track.sourceUrl,
          eventType, listenedMs: Math.max(0, Math.round(listenedMs * 1000))
        })
      });
    } catch { /* Listening history must never interrupt playback. */ }
  }

  async function startTrack(track: PlayerTrack, index: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (!track.audioUrl || !/^https?:\/\//i.test(track.audioUrl)) {
      setPlaybackError(t("This result has no playable audio stream. Open the provider page for details."));
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }
    currentRef.current = track;
    setCurrentTrack(track);
    setQueueIndex(index);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);
    setBuffered(0);
    setPlaybackError("");
    setIsLoading(true);
    audio.pause();
    audio.src = track.audioUrl;
    audio.load();
    try {
      await audio.play();
      setPlaybackError("");
    } catch (error) {
      setIsPlaying(false);
      setIsLoading(false);
      const name = error instanceof Error ? error.name : "";
      setPlaybackError(name === "NotAllowedError"
        ? t("Your browser blocked playback. Tap Play once more to allow audio.")
        : name === "NotSupportedError"
          ? t("The provider returned an audio format this browser cannot play.")
          : t("The audio stream did not start. Check your connection or try another track."));
    }
  }

  function playTrack(track: PlayerTrack, nextQueue?: PlayerTrack[]) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentRef.current?.id === track.id) {
      if (audio.paused) {
        setPlaybackError("");
        setIsLoading(true);
        void audio.play().catch((error: unknown) => {
          setIsPlaying(false); setIsLoading(false);
          setPlaybackError(error instanceof Error && error.name === "NotAllowedError"
            ? t("Tap Play again to allow audio in your browser.")
            : t("Could not resume this audio stream."));
        });
      } else audio.pause();
      return;
    }
    if (currentRef.current && audio.currentTime > 0) {
      void recordEvent(currentRef.current, "skip", audio.currentTime);
    }
    const selectedQueue = nextQueue?.length ? nextQueue : [track];
    const index = Math.max(0, selectedQueue.findIndex((item) => item.id === track.id));
    setQueue(selectedQueue);
    void startTrack(track, index);
  }

  function playAt(index: number, recordSkip = true) {
    const track = queue[index];
    const audio = audioRef.current;
    if (!track || !audio) return;
    if (recordSkip && currentRef.current && audio.currentTime > 0) {
      void recordEvent(currentRef.current, "skip", audio.currentTime);
    }
    void startTrack(track, index);
  }

  function nextTrack() {
    if (!queue.length) return;
    if (shuffle && queue.length > 1) {
      let next = queueIndex;
      while (next === queueIndex) next = Math.floor(Math.random() * queue.length);
      playAt(next);
    } else if (queueIndex < queue.length - 1) playAt(queueIndex + 1);
    else if (repeatMode === "all") playAt(0);
    else { const audio = audioRef.current; if (audio) audio.pause(); setIsPlaying(false); }
  }

  function previousTrack() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (queueIndex > 0) playAt(queueIndex - 1);
    else if (repeatMode === "all" && queue.length) playAt(queue.length - 1);
    else if (audio) { audio.currentTime = 0; setCurrentTime(0); }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) {
      setPlaybackError("");
      setIsLoading(true);
      void audio.play().catch((error: unknown) => {
        setIsPlaying(false); setIsLoading(false);
        setPlaybackError(error instanceof Error && error.name === "NotAllowedError"
          ? t("Tap Play again to allow audio in your browser.")
          : t("Could not start this audio stream."));
      });
    } else audio.pause();
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => { setIsPlaying(true); setIsLoading(false); setPlaybackError(""); const track = currentRef.current; if (track) void recordEvent(track, "play", audio.currentTime); };
    const onPlaying = () => { setIsPlaying(true); setIsLoading(false); setPlaybackError(""); };
    const onPause = () => { setIsPlaying(false); setIsLoading(false); };
    const onWaiting = () => { if (!audio.paused) setIsLoading(true); };
    const onCanPlay = () => setIsLoading(false);
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onDuration = () => {
      const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const metadataDuration = currentRef.current?.durationSeconds || 0;
      setDuration(mediaDuration || metadataDuration);
    };
    const onProgress = () => {
      try {
        if (audio.buffered.length && Number.isFinite(audio.duration) && audio.duration > 0) {
          setBuffered(audio.buffered.end(audio.buffered.length - 1));
        }
      } catch { /* A stream may not expose a seekable buffered range. */ }
    };
    const onEnded = () => {
      const track = currentRef.current;
      if (track) void recordEvent(track, "complete", audio.duration || audio.currentTime);
      if (repeatMode === "one") { audio.currentTime = 0; void audio.play().catch(() => setPlaybackError(t("Could not replay this track."))); }
      else if (shuffle && queue.length > 1) nextTrack();
      else if (queueIndex < queue.length - 1) playAt(queueIndex + 1, false);
      else if (repeatMode === "all" && queue.length) playAt(0, false);
      else setIsPlaying(false);
    };
    const onError = () => {
      setIsLoading(false); setIsPlaying(false);
      const failedTrack = currentRef.current;
      if (!failedTrack || fallbackAttemptsRef.current.has(failedTrack.id) || !API) {
        setPlaybackError(mediaErrorMessage(audio.error?.code, t));
        return;
      }
      fallbackAttemptsRef.current.add(failedTrack.id);
      const query = [failedTrack.title, failedTrack.artist].filter(Boolean).join(" ");
      void fetch(`${API}/api/v1/search/music?${new URLSearchParams({ q: query, type: "tracks", limit: "20" }).toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Alternative catalog search failed");
          return await response.json() as { tracks?: Array<PlayerTrack & { provider?: string; playable?: boolean }> };
        })
        .then((result) => {
          const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, " ").trim();
          const wantedTitle = normalize(failedTrack.title);
          const wantedArtist = normalize(failedTrack.artist);
          const candidate = (result.tracks ?? []).find((item) => {
            if (!item.playable || !item.audioUrl || item.id === failedTrack.id) return false;
            const titleMatch = normalize(item.title) === wantedTitle;
            const artist = normalize(item.artist);
            const artistMatch = artist === wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist);
            const durationMatch = !failedTrack.durationSeconds || !item.durationSeconds || Math.abs(item.durationSeconds - failedTrack.durationSeconds) <= 8;
            return titleMatch && artistMatch && durationMatch;
          });
          if (!candidate) {
            setPlaybackError(mediaErrorMessage(audio.error?.code, t));
            return;
          }
          const resolved: PlayerTrack = {
            id: candidate.id, title: candidate.title, artist: candidate.artist,
            album: candidate.album ?? null, durationSeconds: candidate.durationSeconds ?? 0,
            artworkUrl: candidate.artworkUrl ?? failedTrack.artworkUrl,
            audioUrl: candidate.audioUrl, licenseUrl: candidate.licenseUrl ?? "", sourceUrl: candidate.sourceUrl ?? ""
          };
          setQueue((items) => items.map((item, index) => index === queueIndex ? resolved : item));
          setPlaybackError(t("Original source unavailable. Playing a matching track from another playable catalog."));
          void startTrack(resolved, queueIndex);
        })
        .catch(() => setPlaybackError(mediaErrorMessage(audio.error?.code, t)));
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("progress", onProgress);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("progress", onProgress);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [queue, queueIndex, repeatMode, shuffle, t]);

  useEffect(() => {
    if (!playerSettingsReady) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    try { localStorage.setItem("sonora-player-settings", JSON.stringify({ volume, muted, repeatMode, shuffle, playbackMode })); } catch {}
  }, [playerSettingsReady, volume, muted, repeatMode, shuffle, playbackMode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackMode === "speed" ? 1.25 : playbackMode === "slowed" ? 0.8 : 1;
    audio.preservesPitch = true;
  }, [playbackMode]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("sonora-player-settings") || "{}") as {
        volume?: number; muted?: boolean; repeatMode?: RepeatMode; shuffle?: boolean;
        playbackMode?: "original" | "speed" | "slowed";
      };
      if (typeof saved.volume === "number") setVolume(Math.min(1, Math.max(0, saved.volume)));
      if (typeof saved.muted === "boolean") setMuted(saved.muted);
      if (saved.repeatMode === "off" || saved.repeatMode === "all" || saved.repeatMode === "one") setRepeatMode(saved.repeatMode);
      if (typeof saved.shuffle === "boolean") setShuffle(saved.shuffle);
      if (saved.playbackMode === "original" || saved.playbackMode === "speed" || saved.playbackMode === "slowed") setPlaybackMode(saved.playbackMode);
    } catch {
      // Invalid local settings should fall back to safe defaults.
    } finally {
      setPlayerSettingsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!currentTrack || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title, artist: currentTrack.artist,
        album: currentTrack.album || "SONORA",
        artwork: currentTrack.artworkUrl ? [
          { src: currentTrack.artworkUrl, sizes: "96x96", type: "image/jpeg" },
          { src: currentTrack.artworkUrl, sizes: "512x512", type: "image/jpeg" }
        ] : []
      });
      navigator.mediaSession.setActionHandler("play", () => { if (audioRef.current?.paused) togglePlay(); });
      navigator.mediaSession.setActionHandler("pause", () => { if (audioRef.current && !audioRef.current.paused) togglePlay(); });
      navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
      navigator.mediaSession.setActionHandler("nexttrack", nextTrack);
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        const audio = audioRef.current;
        if (audio && typeof details.seekTime === "number") audio.currentTime = details.seekTime;
      });
    } catch { /* Media Session is optional and browser-dependent. */ }
  }, [currentTrack, isPlaying, queue, queueIndex, repeatMode, shuffle, t]);

  const value = useMemo(() => ({ currentTrack, isPlaying, playTrack, togglePlay }), [currentTrack, isPlaying]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" playsInline />
      {currentTrack && (
        <>
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#10111a]/96 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-16px_50px_rgba(0,0,0,.45)] backdrop-blur-2xl md:px-8">
            <div className="mx-auto max-w-[1440px]">
              <div className="mb-1.5 flex items-center gap-2 text-[10px] tabular-nums text-slate-500">
                <span>{timeLabel(currentTime)}</span>
                <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${duration ? Math.min(100, buffered / duration * 100) : 0}%` }}/>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-violet-300" style={{ width: `${duration ? Math.min(100, currentTime / duration * 100) : 0}%` }}/>
                  <input aria-label={t("Seek through track")} type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} disabled={!duration} onChange={(event) => {
                    const next = Number(event.target.value);
                    if (audioRef.current && Number.isFinite(next)) { audioRef.current.currentTime = next; setCurrentTime(next); }
                  }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"/>
                </div>
                <span>{timeLabel(duration)}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <button type="button" onClick={() => setExpanded(true)} aria-label={t("Open full player")} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left hover:bg-white/[0.04] sm:flex-none sm:w-[28%]">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-violet-300/10">
                    <div className="grid h-full w-full place-items-center text-violet-200"><ListMusic size={19}/></div>
                    {currentTrack.artworkUrl && <img src={currentTrack.artworkUrl} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover"/>}
                  </div>
                  <div className="min-w-0"><p className="truncate text-xs font-semibold sm:text-sm">{currentTrack.title}</p><p className="truncate text-[11px] text-slate-400">{currentTrack.artist}</p></div>
                </button>
                <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                  <button type="button" onClick={() => setShuffle((v) => !v)} aria-label={t("Shuffle")} aria-pressed={shuffle} className={`hidden rounded-lg p-2 sm:block ${shuffle ? "text-violet-200" : "text-slate-500 hover:text-white"}`}><Shuffle size={17}/></button>
                  <button type="button" onClick={previousTrack} aria-label={t("Previous track")} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><SkipBack size={18}/></button>
                  <button type="button" onClick={togglePlay} aria-label={isPlaying ? t("Pause") : t("Play")} className="grid h-10 w-10 place-items-center rounded-full bg-violet-200 text-[#171323] shadow-lg shadow-violet-950/30">
                    {isLoading ? <LoaderCircle size={18} className="animate-spin"/> : isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor" className="ml-0.5"/>}
                  </button>
                  <button type="button" onClick={nextTrack} aria-label={t("Next track")} className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><SkipForward size={18}/></button>
                  <button type="button" onClick={() => setRepeatMode((m) => m === "off" ? "all" : m === "all" ? "one" : "off")} aria-label={t("Repeat")} aria-pressed={repeatMode !== "off"} className={`hidden rounded-lg p-2 sm:block ${repeatMode !== "off" ? "text-violet-200" : "text-slate-500 hover:text-white"}`}>{repeatMode === "one" ? <Repeat1 size={17}/> : <Repeat size={17}/>}</button>
                </div>
                <div className="hidden shrink-0 items-center gap-2 md:flex">
                  <button type="button" onClick={() => setMuted((v) => !v)} aria-label={muted ? t("Unmute") : t("Mute")} className="rounded-lg p-2 text-slate-400 hover:text-white">{muted || volume === 0 ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
                  <input aria-label={t("Volume")} type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }} className="w-20 accent-violet-300"/>
                </div>
                <button type="button" onClick={() => setQueueOpen((open) => !open)} aria-label={t("Toggle queue")} aria-pressed={queueOpen} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10"><ListMusic size={19}/></button>
              </div>
              {playbackError && <p role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-rose-300/15 bg-rose-300/5 px-3 py-2 text-[11px] leading-4 text-rose-200"><AlertCircle size={14} className="mt-0.5 shrink-0"/>{playbackError}</p>}
              {queueOpen && <div className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-black/40 p-2">
                <div className="mb-2 flex items-center justify-between px-2 text-xs text-slate-400"><span>{t("Up next")} · {queue.length} {t("tracks")}</span><button type="button" onClick={() => setQueueOpen(false)} aria-label={t("Close queue")}><X size={14}/></button></div>
                {queue.map((item, index) => <button key={item.id} type="button" onClick={() => playAt(index)} className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left text-xs hover:bg-white/5 ${index === queueIndex ? "text-violet-200" : "text-slate-300"}`}>
                  <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white/5"><span className="grid h-full w-full place-items-center"><ListMusic size={13}/></span>{item.artworkUrl && <img src={item.artworkUrl} alt="" onError={(event) => event.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover"/>}</span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span><span className="max-w-24 truncate text-slate-500">{item.artist}</span>
                  {index === queueIndex && isPlaying && <span className="text-violet-200">♫</span>}
                </button>)}
              </div>}
            </div>
          </div>
          {expanded && <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#090a12] px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(22px,env(safe-area-inset-top))]">
            <div className="mx-auto flex min-h-full w-full max-w-xl flex-col">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setExpanded(false)} aria-label={t("Minimize player")} className="rounded-full p-3 text-slate-300 hover:bg-white/10"><ChevronDown size={23}/></button>
                <div className="text-center"><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-violet-200">SONORA</p><p className="mt-1 text-xs text-slate-500">{t("Now playing")}</p></div>
                <button type="button" onClick={() => { setQueueOpen((v) => !v); setExpanded(false); }} aria-label={t("Open queue")} className="rounded-full p-3 text-slate-300 hover:bg-white/10"><ListMusic size={21}/></button>
              </div>
              <div className="flex flex-1 flex-col justify-center py-8">
                <div className="mx-auto aspect-square w-full max-w-[min(78vw,390px)] overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-700/30 via-[#211934] to-slate-900 shadow-2xl shadow-violet-950/30">
                  <div className="grid h-full w-full place-items-center text-violet-100"><ListMusic size={76} strokeWidth={1}/></div>
                  {currentTrack.artworkUrl && <img src={currentTrack.artworkUrl} alt={currentTrack.title} onError={(event) => event.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover"/>}
                </div>
                <div className="mt-8 flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold tracking-tight">{currentTrack.title}</h2><p className="mt-1 truncate text-base text-slate-400">{currentTrack.artist}</p></div><a href={currentTrack.sourceUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white">{t("Source")}</a></div>
                <div className="mt-8 flex items-center gap-3 text-xs tabular-nums text-slate-400"><span>{timeLabel(currentTime)}</span><div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="absolute inset-y-0 left-0 bg-white/20" style={{width:`${duration ? Math.min(100, buffered / duration * 100) : 0}%`}}/><div className="absolute inset-y-0 left-0 rounded-full bg-violet-300" style={{width:`${duration ? Math.min(100, currentTime / duration * 100) : 0}%`}}/><input type="range" aria-label={t("Seek through track")} min="0" max={duration || 0} step="0.1" value={Math.min(currentTime,duration || 0)} disabled={!duration} onChange={(event)=>{const v=Number(event.target.value);if(audioRef.current){audioRef.current.currentTime=v;setCurrentTime(v);}}} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></div><span>{timeLabel(duration)}</span></div>
                <div className="mt-7 flex items-center justify-between">
                  <button type="button" onClick={()=>setShuffle(v=>!v)} aria-label={t("Shuffle")} className={shuffle?"text-violet-200":"text-slate-500"}><Shuffle size={21}/></button>
                  <button type="button" onClick={previousTrack} aria-label={t("Previous track")} className="text-slate-200"><SkipBack size={27}/></button>
                  <button type="button" onClick={togglePlay} aria-label={isPlaying?t("Pause"):t("Play")} className="grid h-16 w-16 place-items-center rounded-full bg-violet-200 text-[#171323] shadow-xl shadow-violet-950/30">{isLoading?<LoaderCircle size={27} className="animate-spin"/>:isPlaying?<Pause size={28} fill="currentColor"/>:<Play size={28} fill="currentColor"/>}</button>
                  <button type="button" onClick={nextTrack} aria-label={t("Next track")} className="text-slate-200"><SkipForward size={27}/></button>
                  <button type="button" onClick={()=>setRepeatMode(m=>m==="off"?"all":m==="all"?"one":"off")} aria-label={t("Repeat")} className={repeatMode!=="off"?"text-violet-200":"text-slate-500"}>{repeatMode==="one"?<Repeat1 size={21}/>:<Repeat size={21}/>}</button>
                </div>
                <div className="mt-8 flex items-center gap-3"><VolumeX size={17} className="text-slate-500"/><input aria-label={t("Volume")} type="range" min="0" max="1" step="0.01" value={muted?0:volume} onChange={event=>{setVolume(Number(event.target.value));setMuted(false);}} className="flex-1 accent-violet-300"/><Volume2 size={17} className="text-slate-400"/></div>
                {playbackError && <p role="status" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 p-3 text-sm text-rose-200">{playbackError}</p>}
                <div className="mt-8 flex flex-wrap justify-center gap-2">
                  {(["original","speed","slowed"] as const).map(mode=><button key={mode} type="button" onClick={()=>setPlaybackMode(mode)} aria-pressed={playbackMode===mode} className={`rounded-full px-4 py-2 text-xs ${playbackMode===mode?"bg-violet-200 text-[#171323]":"border border-white/10 text-slate-400"}`}>{mode==="original"?t("Original"):mode==="speed"?t("Speed up")+" · 1.25×":t("Slowed")+" · 0.8×"}</button>)}
                </div>
              </div>
              <div className="flex justify-center pb-2"><button type="button" onClick={()=>{setQueueOpen(true);setExpanded(false);}} className="flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-slate-300"><ListMusic size={17}/>{t("Open queue")} · {queue.length}</button></div>
            </div>
          </div>}
        </>
      )}
    </PlayerContext.Provider>
  );
}
