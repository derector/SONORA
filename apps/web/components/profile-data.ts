"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { usePlayer, type PlayerTrack } from "./player-provider";
import { profileRequest } from "../lib/profile";

export type SavedTrack = {
  provider_track_id: string; title: string; artist_name: string; album_name: string | null;
  duration_seconds: number | null; artwork_url: string | null; license_url: string; source_url: string;
};
export type HistoryTrack = SavedTrack & { id: string; event_type: "play" | "complete" | "skip"; listened_ms: number; occurred_at: string };
export type Playlist = { id: string; title: string; description: string | null; is_public?: boolean; updated_at: string };
export type Stats = {
  windowDays: number;
  historyMayBeTruncated?: boolean;
  counts: { events: number; favorites: number; catalogFavorites: number; playlists: number; followers: number; following: number; artists: number; albums: number };
  minutes: { week: number; month: number; total: number }; streakDays: number;
  topArtists: { name: string; events: number; minutes: number }[];
  topGenres: { name: string; events: number }[]; declaredGenres: string[];
  daily: { date: string; minutes: number }[]; monthly: { month: string; minutes: number }[];
  albums: { title: string; artist: string; tracks: number; artworkUrl: string | null }[];
};
export type Taste = {
  windowDays: number;
  genres: { declared: string[]; measured: { name: string; events: number }[]; weighted: { name: string; weight: number }[]; source: "listening" | "declared" | "none" };
  energy: number | null; tempo: number | null; tempoBand: "fast" | "moderate" | "mid-tempo" | "slow" | null;
  bpm: null; moodSample: number; moodError: string | null;
  artistAffinity: { artist: string; weight: number }[];
};

// Component mount is the lazy boundary. Changing panes unmounts requests;
// AbortController also prevents stale responses replacing a newer tab/session.
export function useProfileResource<T>(path: string) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    setLoading(true); setError(false); setData(null);
    profileRequest<T>(path, accessToken, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, accessToken, revision]);
  return { data, loading, error, retry, setData };
}

export function rowTrack(item: SavedTrack) {
  return { id: item.provider_track_id, title: item.title, artist: item.artist_name, artworkUrl: item.artwork_url, durationSeconds: item.duration_seconds };
}
export function useSavedPlayback() {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(false);
  async function play(item: SavedTrack) {
    if (currentTrack?.id === item.provider_track_id) { togglePlay(); return; }
    setBusy(item.provider_track_id); setError(false);
    try {
      const result = await profileRequest<{ items: PlayerTrack[] }>(`/providers/jamendo/tracks?id=${encodeURIComponent(item.provider_track_id)}`);
      const track = result.items?.find((candidate) => candidate.id === item.provider_track_id && candidate.audioUrl);
      if (!track) throw new Error("Unavailable recording");
      playTrack(track, [track]);
    } catch { setError(true); }
    finally { setBusy(""); }
  }
  return { currentTrack, isPlaying, busy, error, play };
}
