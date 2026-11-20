"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown, ListMusic, Pause, Play, Repeat, Repeat1,
  SkipBack, SkipForward, Shuffle, Volume2, VolumeX, X, AlertCircle, LoaderCircle
} from "lucide-react";
import { useLanguage } from "./language-provider";
import { Artwork } from "./ui/artwork";
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
const PLAYER_STATE_KEY = "sonora-player-state";
const PLAYER_STATE_TTL = 7 * 24 * 60 * 60 * 1000;

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside PlayerProvider");
  return value;
}

function timeLabel(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

// Attribution has exactly one visible home in the interface: the "About track"
// row of the full player. Creative Commons URLs are shortened to their
// recognizable code instead of being dumped on the user.
function licenseLabel(licenseUrl: string) {
  if (/publicdomain\/zero/i.test(licenseUrl)) return "CC0";
  const match = /licenses\/([a-z-]+)\/([0-9.]+)/i.exec(licenseUrl);
  return match ? `CC ${match[1].toUpperCase()} ${match[2]}` : "";
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

type JamendoItem = {
  id?: string;
  title?: string;
  artist?: string;
  album?: string | null;
  durationSeconds?: number;
  artworkUrl?: string | null;
  audioUrl?: string;
  licenseUrl?: string;
  sourceUrl?: string;
  available?: boolean;
};
type JamendoResolution =
  | { status: "fresh"; item: JamendoItem }
  | { status: "unavailable" }
  | { status: "unknown" };

function extraField(track: PlayerTrack, key: string) {
  const value = (track as PlayerTrack & Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

// Catalog, search and history payloads use different id shapes ("jamendo:123",
// a bare numeric id, or a share URL), so the numeric provider id is resolved
// across all of them before the stream is refreshed.
function jamendoIdOf(track: PlayerTrack) {
  for (const value of [track.id, extraField(track, "providerTrackId"), track.sourceUrl, track.audioUrl]) {
    if (!value) continue;
    const prefixed = /^jamendo:(\d{1,24})$/i.exec(value)?.[1];
    if (prefixed) return prefixed;
    if (/^\d{1,24}$/.test(value)) return value;
    const path = /(?:jamendo\.com\/(?:track|album)\/|download\/track\/)(\d{1,24})/i.exec(value)?.[1];
    if (path) return path;
  }
  return "";
}

function isJamendoTrack(track: PlayerTrack) {
  const provider = extraField(track, "provider").toLowerCase();
  if (provider && provider !== "jamendo") return false;
  if (/storage\.jamendo\.com/i.test(track.audioUrl || "")) return true;
  return (provider === "jamendo" || /jamendo\.com/i.test(track.sourceUrl || "")) && jamendoIdOf(track).length > 0;
}

// Provider streams are short-lived signed URLs. Ask the API for a fresh one and
// treat a confirmed miss as a real availability failure, not a playback error.
async function resolveJamendoTrack(track: PlayerTrack): Promise<JamendoResolution> {
  const jid = jamendoIdOf(track);
  if (!jid || !API) return { status: "unknown" };
  try {
    const response = await fetch(`${API}/api/v1/providers/jamendo/tracks?id=${encodeURIComponent(jid)}`, { cache: "no-store" });
    if (response.status === 404) return { status: "unavailable" };
    if (!response.ok) return { status: "unknown" };
    const data = await response.json() as { items?: JamendoItem[] };
    const item = data.items?.[0];
    // An empty payload means the catalog no longer serves this track at all.
    if (!item || item.available === false) return { status: "unavailable" };
    if (!item.audioUrl) return { status: "unknown" };
    return { status: "fresh", item };
  } catch {
    // An API outage is not evidence that the track disappeared.
    return { status: "unknown" };
  }
}

// The fresh payload carries the signed stream and current metadata; the title
// and artist already shown on screen stay untouched.
function mergeJamendoItem(track: PlayerTrack, item: JamendoItem): PlayerTrack {
  return {
    ...track,
    audioUrl: item.audioUrl || track.audioUrl,
    album: item.album ?? track.album,
    durationSeconds: item.durationSeconds || track.durationSeconds,
    artworkUrl: item.artworkUrl ?? track.artworkUrl,
    licenseUrl: item.licenseUrl || track.licenseUrl,
    sourceUrl: item.sourceUrl || track.sourceUrl
  };
}

function replaceTrack(items: PlayerTrack[], replacement: PlayerTrack, index: number) {
  return items.map((item, itemIndex) => item.id === replacement.id || itemIndex === index ? replacement : item);
}

type StoredPlayerState = {
  track: PlayerTrack;
  queue: PlayerTrack[];
  queueIndex: number;
  currentTime: number;
  savedAt: number;
};

function isPlayerTrack(value: unknown): value is PlayerTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<PlayerTrack>;
  return typeof track.id === "string" && typeof track.title === "string" && typeof track.audioUrl === "string";
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentRef = useRef<PlayerTrack | null>(null);
  const fallbackAttemptsRef = useRef<Set<string>>(new Set());
  // Streams already re-resolved once this session, and tracks the source
  // confirmed as gone. Both guards keep the failure chain from looping.
  const refreshedRef = useRef<Set<string>>(new Set());
  const skippedRef = useRef<Set<string>>(new Set());
  const seekRef = useRef(0);
  const queueRef = useRef<PlayerTrack[]>([]);
  const queueIndexRef = useRef(0);
  const lastStateSaveRef = useRef(0);
  const persistAllowedRef = useRef(true);
  const awaitingRestoreRef = useRef(false);
  const restoreRef = useRef<{ track: PlayerTrack | null; time: number }>({ track: null, time: 0 });
  const wasSignedInRef = useRef(false);
  const tokenRef = useRef("");
  const { accessToken, isAuthenticated } = useAuth();
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [playbackMode, setPlaybackMode] = useState<"original" | "speed" | "slowed">("original");
  const [playerSettingsReady, setPlayerSettingsReady] = useState(false);
  const { t } = useLanguage();

  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);

  async function recordEvent(track: PlayerTrack, eventType: "play" | "complete" | "skip", listenedMs: number) {
    const token = tokenRef.current;
    // Provider history currently accepts Jamendo IDs only. Identify Jamendo
    // by its canonical source URL because catalog and search responses use
    // different ID shapes (raw numeric ID vs. "jamendo:<id>").
    if (!token || !/^https:\/\/www\.jamendo\.com\//i.test(track.sourceUrl)) return;
    const providerTrackId = track.id.startsWith("jamendo:")
      ? track.id.slice("jamendo:".length)
      : track.id;
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

  // `skipResolve` is used by the stream-refresh retry, which already holds a
  // freshly signed URL and must not ask the provider a second time.
  // `resumeFrom` is the position a restored session jumps back to once the
  // fresh stream reports its metadata.
  async function startTrack(track: PlayerTrack, index: number, skipResolve = false, resumeFrom = 0) {
    const audio = audioRef.current;
    if (!audio) return;
    let playable = track;
    // Provider streams are signed and expire, so a Jamendo track is always
    // re-resolved to a fresh URL just before it is handed to the element.
    if (!skipResolve && isJamendoTrack(track)) {
      const resolution = await resolveJamendoTrack(track);
      if (resolution.status === "unavailable") {
        await handleUnavailableTrack(track, index);
        return;
      }
      if (resolution.status === "fresh") {
        playable = mergeJamendoItem(track, resolution.item);
        setQueue((items) => replaceTrack(items, playable, index));
      }
    }
    if (!playable.audioUrl || !/^https?:\/\//i.test(playable.audioUrl)) {
      setPlaybackError(t("This result has no playable audio stream. Open the provider page for details."));
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }
    currentRef.current = playable;
    setCurrentTrack(playable);
    setQueueIndex(index);
    setCurrentTime(0);
    // A freshly started track owns its position from here on.
    awaitingRestoreRef.current = false;
    restoreRef.current = { track: playable, time: 0 };
    seekRef.current = resumeFrom;
    skippedRef.current.delete(playable.id);
    setDuration(playable.durationSeconds || 0);
    setBuffered(0);
    setPlaybackError("");
    setIsLoading(true);
    audio.pause();
    audio.src = playable.audioUrl;
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

  // A track the source no longer serves is reported honestly and the queue
  // moves on once. The skipped set stops a chain of dead tracks from looping.
  async function handleUnavailableTrack(track: PlayerTrack, index: number) {
    const audio = audioRef.current;
    if (audio) audio.pause();
    skippedRef.current.add(track.id);
    setCurrentTrack(track);
    setQueueIndex(index);
    setIsPlaying(false);
    setIsLoading(false);
    setPlaybackError(t("Original source became unavailable for this track."));
    const nextIndex = index + 1;
    const next = queueRef.current[nextIndex];
    if (next && !skippedRef.current.has(next.id)) playAt(nextIndex, false);
  }

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);

  function playTrack(track: PlayerTrack, nextQueue?: PlayerTrack[]) {
    const audio = audioRef.current;
    if (!audio) return;
    if (currentRef.current?.id === track.id) {
      if (audio.paused) {
        // The visible track may still be the paused one from a previous visit.
        if (awaitingRestoreRef.current) { resumeRestored(); return; }
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
    queueRef.current = selectedQueue;
    queueIndexRef.current = index;
    void startTrack(track, index);
  }

  function playAt(index: number, recordSkip = true) {
    // Read the mirror, not the state closure: an async fallback chain can be
    // several renders behind the queue that is actually on screen.
    const track = queueRef.current[index];
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
      // A restored session is paused on purpose; its first resume goes through
      // the normal start path so the stream URL is re-resolved first.
      if (awaitingRestoreRef.current) { resumeRestored(); return; }
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

  // Only refs are read here, so the audio listeners and the pagehide handler
  // can persist the session without re-binding on every render.
  function persistState(force = false) {
    const audio = audioRef.current;
    const track = currentRef.current;
    if (!audio || !track || !persistAllowedRef.current) return;
    const now = Date.now();
    if (!force && now - lastStateSaveRef.current < 5000) return;
    lastStateSaveRef.current = now;
    try {
      const state: StoredPlayerState = {
        track,
        queue: queueRef.current,
        queueIndex: queueIndexRef.current,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        savedAt: now
      };
      localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(state));
    } catch { /* Private mode or a full quota must not break playback. */ }
  }

  function resumeRestored() {
    const track = restoreRef.current.track ?? currentRef.current;
    if (!track) return;
    awaitingRestoreRef.current = false;
    void startTrack(track, queueIndexRef.current, false, restoreRef.current.time);
  }

  useEffect(() => {
    async function restore() {
      const audio = audioRef.current;
      if (!audio) return;
      let raw: string | null = null;
      try { raw = localStorage.getItem(PLAYER_STATE_KEY); } catch { return; }
      if (!raw) return;
      let state: StoredPlayerState | null = null;
      try { state = JSON.parse(raw) as StoredPlayerState; } catch { state = null; }
      if (!state || !isPlayerTrack(state.track) || typeof state.savedAt !== "number"
        || Date.now() - state.savedAt > PLAYER_STATE_TTL) {
        try { localStorage.removeItem(PLAYER_STATE_KEY); } catch {}
        return;
      }
      const savedQueue = Array.isArray(state.queue) ? state.queue.filter(isPlayerTrack) : [];
      const nextQueue = savedQueue.length ? savedQueue : [state.track];
      const index = Math.min(Math.max(0, Number(state.queueIndex) || 0), nextQueue.length - 1);
      const time = Math.max(0, Number(state.currentTime) || 0);
      queueRef.current = nextQueue;
      queueIndexRef.current = index;
      restoreRef.current = { track: state.track, time };
      awaitingRestoreRef.current = true;
      currentRef.current = state.track;
      // Metadata only: the browser blocks autoplay, so the restored track is
      // presented paused and the URL is refreshed on the first Play press.
      if (/^https?:\/\//i.test(state.track.audioUrl)) {
        audio.src = state.track.audioUrl;
        audio.load();
      }
      setQueue(nextQueue);
      setQueueIndex(index);
      setCurrentTrack(state.track);
      setCurrentTime(time);
      setDuration(state.track.durationSeconds || 0);
    }
    void restore();
  }, []);

  useEffect(() => {
    const onHide = () => persistState(true);
    const onVisibility = () => { if (document.visibilityState === "hidden") persistState(true); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // A signed-out device must not keep another account's listening position.
  useEffect(() => {
    if (wasSignedInRef.current && !isAuthenticated) {
      persistAllowedRef.current = false;
      awaitingRestoreRef.current = false;
      restoreRef.current = { track: null, time: 0 };
      try { localStorage.removeItem(PLAYER_STATE_KEY); } catch {}
    }
    if (isAuthenticated) persistAllowedRef.current = true;
    wasSignedInRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => { setIsPlaying(true); setIsLoading(false); setPlaybackError(""); const track = currentRef.current; if (track) void recordEvent(track, "play", audio.currentTime); };
    const onPlaying = () => { setIsPlaying(true); setIsLoading(false); setPlaybackError(""); };
    const onPause = () => { setIsPlaying(false); setIsLoading(false); persistState(true); };
    const onWaiting = () => { if (!audio.paused) setIsLoading(true); };
    const onCanPlay = () => setIsLoading(false);
    const onTime = () => {
      setCurrentTime(audio.currentTime || 0);
      if (!audio.paused) persistState();
    };
    const onDuration = () => {
      const mediaDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      const metadataDuration = currentRef.current?.durationSeconds || 0;
      setDuration(mediaDuration || metadataDuration);
      // A restored session jumps back to its saved position as soon as the
      // fresh stream exposes real metadata, while staying paused.
      const pending = seekRef.current;
      if (pending > 0 && mediaDuration > 1 && pending < mediaDuration - 1) {
        seekRef.current = 0;
        try { audio.currentTime = pending; setCurrentTime(pending); } catch { /* Keep the stream start. */ }
      }
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
    const searchFallback = (failedTrack: PlayerTrack) => {
      fallbackAttemptsRef.current.add(failedTrack.id);
      const query = [failedTrack.title, failedTrack.artist].filter(Boolean).join(" ");
      void fetch(`${API}/api/v1/search/music?${new URLSearchParams({ q: query, type: "tracks", limit: "20" }).toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("Alternative catalog search failed");
          return await response.json() as { tracks?: Array<PlayerTrack & { provider?: string; playable?: boolean }> };
        })
        .then((result) => {
          // Use Unicode property escapes so Cyrillic and other scripts are
          // normalized correctly when looking for an equivalent playable source.
          const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
          const wantedTitle = normalize(failedTrack.title);
          const wantedArtist = normalize(failedTrack.artist);
          const candidate = wantedTitle && wantedArtist ? (result.tracks ?? []).find((item) => {
            if (!item.playable || !item.audioUrl || item.id === failedTrack.id) return false;
            const title = normalize(item.title);
            const artist = normalize(item.artist);
            if (!title || !artist) return false;
            const titleMatch = title === wantedTitle;
            const artistMatch = artist === wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist);
            const durationMatch = !failedTrack.durationSeconds || !item.durationSeconds || Math.abs(item.durationSeconds - failedTrack.durationSeconds) <= 8;
            return titleMatch && artistMatch && durationMatch;
          }) : undefined;
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
          queueRef.current = replaceTrack(queueRef.current, resolved, queueIndex);
          setQueue(queueRef.current);
          setPlaybackError(t("Original source unavailable. Playing a matching track from another playable catalog."));
          void startTrack(resolved, queueIndex);
        })
        .catch(() => setPlaybackError(mediaErrorMessage(audio.error?.code, t)));
    };
    const onError = () => {
      setIsLoading(false); setIsPlaying(false);
      const failedTrack = currentRef.current;
      if (!failedTrack || !API) {
        setPlaybackError(mediaErrorMessage(audio.error?.code, t));
        return;
      }
      // A restored URL is often expired before the user ever presses Play.
      // Refresh it quietly and stay paused instead of starting audio.
      if (awaitingRestoreRef.current) {
        void resolveJamendoTrack(failedTrack).then((resolution) => {
          if (resolution.status === "unavailable") {
            awaitingRestoreRef.current = false;
            setPlaybackError(t("Original source became unavailable for this track."));
            return;
          }
          if (resolution.status !== "fresh") return;
          const fresh = mergeJamendoItem(failedTrack, resolution.item);
          currentRef.current = fresh;
          restoreRef.current = { track: fresh, time: restoreRef.current.time };
          queueRef.current = replaceTrack(queueRef.current, fresh, queueIndexRef.current);
          setQueue(queueRef.current);
          setCurrentTrack(fresh);
          audio.src = fresh.audioUrl;
          audio.load();
        });
        return;
      }
      // Signed provider URLs expire long before the recording does, so the very
      // same track is re-resolved once before an equivalent is searched for in
      // another catalog.
      if (isJamendoTrack(failedTrack) && !refreshedRef.current.has(failedTrack.id)) {
        refreshedRef.current.add(failedTrack.id);
        void resolveJamendoTrack(failedTrack).then((resolution) => {
          if (resolution.status === "unavailable") { void handleUnavailableTrack(failedTrack, queueIndexRef.current); return; }
          if (resolution.status === "fresh") {
            const fresh = mergeJamendoItem(failedTrack, resolution.item);
            queueRef.current = replaceTrack(queueRef.current, fresh, queueIndexRef.current);
            setQueue(queueRef.current);
            void startTrack(fresh, queueIndexRef.current, true);
            return;
          }
          if (!fallbackAttemptsRef.current.has(failedTrack.id)) searchFallback(failedTrack);
        });
        return;
      }
      if (fallbackAttemptsRef.current.has(failedTrack.id)) {
        setPlaybackError(mediaErrorMessage(audio.error?.code, t));
        return;
      }
      searchFallback(failedTrack);
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
          {/* Sticky mini-player: fixed 68px bar with the header's backdrop blur.
              Progress is a slim 2px violet->teal line on the top edge, driven by
              the same clock as the hover-revealed time labels (group). Error and
              queue float above the bar so it never grows past 68px. */}
          <div className="group fixed inset-x-3 bottom-3 z-50 mx-auto flex h-[var(--miniplayer-h)] max-w-[1440px] items-center gap-2 rounded-card border border-white/10 bg-[#11121d]/90 px-3 shadow-float backdrop-blur-xl sm:gap-3 md:px-4">
            <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-white/10">
              <div className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${duration ? Math.min(100, buffered / duration * 100) : 0}%` }}/>
              <div className="progress-accent absolute inset-y-0 left-0" style={{ width: `${duration ? Math.min(100, currentTime / duration * 100) : 0}%` }}/>
            </div>
            <input aria-label={t("Seek through track")} type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} disabled={!duration} onChange={(event) => {
              const next = Number(event.target.value);
              if (audioRef.current && Number.isFinite(next)) { audioRef.current.currentTime = next; setCurrentTime(next); }
            }} className="absolute inset-x-0 top-0 h-3 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"/>
            <div className="pointer-events-none absolute inset-x-3 bottom-full mb-1 flex justify-between text-[11px] tabular-nums text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span>{timeLabel(currentTime)}</span><span>{timeLabel(duration)}</span>
            </div>
            {(playbackError || queueOpen) && <div className="pointer-events-none absolute inset-x-3 bottom-full mb-7 flex flex-col gap-2">
              {playbackError && <p role="status" className="pointer-events-auto flex items-start gap-2 rounded-card border border-rose-300/15 bg-[#11121d]/95 px-3 py-2 text-[11px] leading-4 text-rose-200 shadow-float backdrop-blur-xl"><AlertCircle size={14} className="mt-0.5 shrink-0"/>{playbackError}</p>}
              {queueOpen && <div className="pointer-events-auto mx-auto max-h-64 w-full max-w-xl overflow-y-auto rounded-card border border-white/10 bg-[#11121d]/95 p-2 shadow-float backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between px-2 text-xs text-muted"><span>{t("Up next")} · {queue.length} {t("tracks")}</span><button type="button" onClick={() => setQueueOpen(false)} aria-label={t("Close queue")} className="btn-icon !h-8 !w-8"><X size={14}/></button></div>
                {queue.map((item, index) => <button key={item.id} type="button" onClick={() => playAt(index)} className={`flex w-full min-w-0 items-center gap-3 rounded-tile px-2 py-2 text-left text-xs hover:bg-white/5 ${index === queueIndex ? "text-violet-200" : "text-slate-300"}`}>
                  <Artwork src={item.artworkUrl} iconSize={13} className="h-8 w-8 shrink-0"/>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span><span className="max-w-24 truncate text-muted">{item.artist}</span>
                  {index === queueIndex && isPlaying && <span className="text-violet-200">♫</span>}
                </button>)}
              </div>}
            </div>}
            <button type="button" onClick={() => setExpanded(true)} aria-label={t("Open full player")} className="flex min-w-0 flex-1 items-center gap-3 rounded-card px-1 py-1 text-left transition hover:bg-white/[0.04] sm:w-[28%] sm:flex-none">
              <Artwork src={currentTrack.artworkUrl} iconSize={19} className="h-12 w-12 shrink-0"/>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{currentTrack.title}</span><span className="block truncate text-xs text-muted">{currentTrack.artist}</span></span>
            </button>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <button type="button" onClick={() => setShuffle((v) => !v)} aria-label={t("Shuffle")} aria-pressed={shuffle} className={`btn-icon hidden sm:grid ${shuffle ? "is-active" : ""}`}><Shuffle size={17}/></button>
              <button type="button" onClick={previousTrack} aria-label={t("Previous track")} className="btn-icon"><SkipBack size={18}/></button>
              <button type="button" onClick={togglePlay} aria-label={isPlaying ? t("Pause") : t("Play")} className="btn-press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-200 text-[#171323] shadow-lg shadow-violet-950/30">
                {isLoading ? <LoaderCircle size={18} className="animate-spin"/> : isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor" className="ml-0.5"/>}
              </button>
              <button type="button" onClick={nextTrack} aria-label={t("Next track")} className="btn-icon"><SkipForward size={18}/></button>
              <button type="button" onClick={() => setRepeatMode((m) => m === "off" ? "all" : m === "all" ? "one" : "off")} aria-label={t("Repeat")} aria-pressed={repeatMode !== "off"} className={`btn-icon hidden sm:grid ${repeatMode !== "off" ? "is-active" : ""}`}>{repeatMode === "one" ? <Repeat1 size={17}/> : <Repeat size={17}/>}</button>
            </div>
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              <button type="button" onClick={() => setMuted((v) => !v)} aria-label={muted ? t("Unmute") : t("Mute")} className="btn-icon">{muted || volume === 0 ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
              <input aria-label={t("Volume")} type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setMuted(false); }} className="w-20 accent-violet-300"/>
            </div>
            <button type="button" onClick={() => setQueueOpen((open) => !open)} aria-label={t("Toggle queue")} aria-pressed={queueOpen} className={`btn-icon ml-auto shrink-0 md:ml-0 ${queueOpen ? "is-active" : ""}`}><ListMusic size={19}/></button>
          </div>
          {expanded && <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#090a12] px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(22px,env(safe-area-inset-top))]">
            <div className="mx-auto flex min-h-full w-full max-w-xl flex-col">
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setExpanded(false)} aria-label={t("Minimize player")} className="rounded-full p-3 text-slate-300 hover:bg-white/10"><ChevronDown size={23}/></button>
                <div className="text-center"><p className="text-[10px] font-semibold uppercase tracking-[.24em] text-violet-200">SONORA</p><p className="mt-1 text-xs text-slate-500">{t("Now playing")}</p></div>
                <button type="button" onClick={() => { setQueueOpen((v) => !v); setExpanded(false); }} aria-label={t("Open queue")} className="rounded-full p-3 text-slate-300 hover:bg-white/10"><ListMusic size={21}/></button>
              </div>
              <div className="flex flex-1 flex-col justify-center py-8">
                <div className="relative mx-auto aspect-square w-full max-w-[min(78vw,390px)] overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-700/30 via-[#211934] to-slate-900 shadow-2xl shadow-violet-950/30">
                  <div className="grid h-full w-full place-items-center text-violet-100"><ListMusic size={76} strokeWidth={1}/></div>
                  {currentTrack.artworkUrl && <img src={currentTrack.artworkUrl} alt={currentTrack.title} onError={(event) => event.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover"/>}
                </div>
                <div className="mt-8 flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold tracking-tight">{currentTrack.title}</h2><p className="mt-1 truncate text-base text-slate-400">{currentTrack.artist}</p></div><button type="button" onClick={() => setAboutOpen((open) => !open)} aria-expanded={aboutOpen} className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white">{t("About track")}</button></div>
                {aboutOpen && <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200">{t("About track")}</p>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-slate-500">{t("Album")}</dt><dd className="min-w-0 max-w-[65%] truncate text-slate-300">{currentTrack.album || t("Independent release")}</dd></div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2"><dt className="text-slate-500">{t("License")}</dt><dd className="text-slate-300">{licenseLabel(currentTrack.licenseUrl) || t("Licensed catalog")}</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {currentTrack.sourceUrl && <a href={currentTrack.sourceUrl} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-2 rounded-full bg-violet-200 px-4 py-2 text-xs font-semibold text-[#171323]">{t("Open source page")}</a>}
                    {currentTrack.licenseUrl && <a href={currentTrack.licenseUrl} target="_blank" rel="noreferrer" className="btn-press inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300 hover:text-white">{t("Read license terms")}</a>}
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-slate-500">{t("SONORA plays licensed catalogs. Rights and attribution always stay with the recording.")}</p>
                  <Link href="/legal" className="mt-2 inline-block text-[11px] text-violet-200 hover:text-white">{t("Licensing and attribution")}</Link>
                </div>}
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
