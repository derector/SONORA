"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ListMusic, Pause, Play, SkipBack, SkipForward, Volume2, X } from "lucide-react";

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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<PlayerTrack | null>(null);
  const tokenRef = useRef("");
  const [currentTrack, setCurrentTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [queueOpen, setQueueOpen] = useState(false);

  async function getToken() {
    if (tokenRef.current) return tokenRef.current;
    try {
      const response = await fetch(`${API}/api/v1/auth/refresh`, { method: "POST", credentials: "include" });
      if (!response.ok) return "";
      const result = await response.json() as { session?: { access_token?: string } };
      tokenRef.current = result.session?.access_token ?? "";
      return tokenRef.current;
    } catch {
      return "";
    }
  }

  async function recordEvent(track: PlayerTrack, eventType: "play" | "complete" | "skip", listenedMs: number) {
    const token = await getToken();
    if (!token) return;
    try {
      await fetch(`${API}/api/v1/provider-history`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          providerTrackId: track.id, title: track.title, artistName: track.artist,
          albumName: track.album, durationSeconds: track.durationSeconds,
          artworkUrl: track.artworkUrl, licenseUrl: track.licenseUrl, sourceUrl: track.sourceUrl,
          eventType, listenedMs: Math.max(0, Math.round(listenedMs * 1000))
        })
      });
    } catch {
      // Playback remains available when history recording is offline.
    }
  }

  function playTrack(track: PlayerTrack, nextQueue?: PlayerTrack[]) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentRef.current?.id === track.id) {
      if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
      else audio.pause();
      return;
    }
    if (currentRef.current && audio.currentTime > 0) {
      void recordEvent(currentRef.current, "skip", audio.currentTime);
    }
    const selectedQueue = nextQueue?.length ? nextQueue : [track];
    const index = Math.max(0, selectedQueue.findIndex((item) => item.id === track.id));
    setQueue(selectedQueue);
    setQueueIndex(index);
    currentRef.current = track;
    setCurrentTrack(track);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);
    audio.src = track.audioUrl;
    audio.load();
    void audio.play().catch(() => setIsPlaying(false));
  }

  function playAt(index: number, recordSkip = true) {
    const track = queue[index];
    if (track) {
      const audio = audioRef.current;
      if (recordSkip && currentRef.current && audio && audio.currentTime > 0) {
        void recordEvent(currentRef.current, "skip", audio.currentTime);
      }
      setQueueIndex(index);
      currentRef.current = track;
      setCurrentTrack(track);
      setCurrentTime(0);
      setDuration(track.durationSeconds || 0);
      if (audio) {
        audio.src = track.audioUrl;
        audio.load();
        void audio.play().catch(() => setIsPlaying(false));
      }
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentRef.current) return;
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setIsPlaying(true);
      const track = currentRef.current;
      if (track) void recordEvent(track, "play", audio.currentTime);
    };
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onEnded = () => {
      const track = currentRef.current;
      if (track) void recordEvent(track, "complete", audio.duration || audio.currentTime);
      if (queueIndex < queue.length - 1) playAt(queueIndex + 1, false);
      else setIsPlaying(false);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", onEnded);
    };
  }, [queue, queueIndex]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const value = useMemo(() => ({ currentTrack, isPlaying, playTrack, togglePlay }), [currentTrack, isPlaying]);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="none" />
      {currentTrack && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#10111a]/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-16px_50px_rgba(0,0,0,.35)] backdrop-blur-2xl md:px-8">
          <div className="mx-auto max-w-[1440px]">
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-violet-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center gap-3">
              {currentTrack.artworkUrl ? <img src={currentTrack.artworkUrl} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <div className="grid h-11 w-11 place-items-center rounded-xl bg-violet-300/10"><ListMusic size={18}/></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{currentTrack.title}</p>
                <p className="truncate text-xs text-slate-400">{currentTrack.artist}</p>
              </div>
              <span className="hidden text-[11px] tabular-nums text-slate-500 sm:block">{timeLabel(currentTime)} / {timeLabel(duration)}</span>
              <button type="button" onClick={() => playAt(Math.max(0, queueIndex - 1))} disabled={queueIndex <= 0} aria-label="Previous track" className="rounded-full p-2 text-slate-300 hover:bg-white/10 disabled:opacity-30"><SkipBack size={18}/></button>
              <button type="button" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className="grid h-10 w-10 place-items-center rounded-full bg-violet-200 text-[#171323]"><span>{isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</span></button>
              <button type="button" onClick={() => playAt(Math.min(queue.length - 1, queueIndex + 1))} disabled={queueIndex >= queue.length - 1} aria-label="Next track" className="rounded-full p-2 text-slate-300 hover:bg-white/10 disabled:opacity-30"><SkipForward size={18}/></button>
              <div className="hidden items-center gap-2 md:flex"><Volume2 size={16} className="text-slate-400"/><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-20 accent-violet-300"/></div>
              <button type="button" onClick={() => setQueueOpen((open) => !open)} aria-label="Toggle queue" className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><ListMusic size={18}/></button>
            </div>
            {queueOpen && <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2">
              <div className="mb-2 flex items-center justify-between px-2 text-xs text-slate-400"><span>Up next · {queue.length} tracks</span><button type="button" onClick={() => setQueueOpen(false)} aria-label="Close queue"><X size={14}/></button></div>
              {queue.map((item, index) => <button key={item.id} type="button" onClick={() => playAt(index)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-xs hover:bg-white/5 ${index === queueIndex ? "text-violet-200" : "text-slate-300"}`}><span className="w-5 text-slate-600">{index + 1}</span><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="max-w-28 truncate text-slate-500">{item.artist}</span></button>)}
            </div>}
          </div>
        </div>
      )}
    </PlayerContext.Provider>
  );
}
