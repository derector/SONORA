"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Disc3, Link2, Play, Plus, Search, Trash2 } from "lucide-react";
import { useLanguage } from "../../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../../components/player-provider";
import { formatDuration, TrackRow } from "../../../components/ui/track-row";
import { RowsSkeleton, StateBlock } from "../../../components/ui/states";

type ProviderTrack = {
  provider: string;
  provider_track_id: string;
  title: string;
  artist_name: string;
  album_name: string | null;
  duration_seconds: number | null;
  artwork_url: string | null;
  license_url: string;
  source_url: string;
  position: number;
};
type Playlist = {
  id: string;
  title: string;
  description: string | null;
  provider_playlist_tracks?: ProviderTrack[];
};
type ApiResult = { playlist?: Playlist; error?: string };
type SearchTrack = PlayerTrack & { id: string; provider: string; providerTrackId?: string; playable?: boolean };
type SearchResult = { items?: SearchTrack[]; tracks?: SearchTrack[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export default function PlaylistDetailPage() {
  const params = useParams<{ playlistId: string }>();
  const playlistId = params.playlistId;
  const { t } = useLanguage();
  const { currentTrack, isPlaying, playTrack } = usePlayer();
  const [token, setToken] = useState("");
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [query, setQuery] = useState("");
  const [searchProvider, setSearchProvider] = useState<"jamendo" | "audius">("jamendo");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [startingId, setStartingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPlaylist = useCallback(async (accessToken: string) => {
    const response = await fetch(`${API}/api/v1/playlists/${encodeURIComponent(playlistId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, credentials: "include"
    });
    const data = await response.json() as ApiResult;
    if (!response.ok || !data.playlist) throw new Error(data.error || "Could not load this playlist.");
    setPlaylist(data.playlist);
  }, [playlistId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<{ session?: { access_token?: string } }> : null)
      .then(async (data) => {
        const accessToken = data?.session?.access_token;
        if (!active || !accessToken) return;
        setToken(accessToken);
        await loadPlaylist(accessToken);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not restore your session."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadPlaylist]);

  async function searchTracks(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true); setError(""); setNotice("");
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "12" });
      const endpoint = searchProvider === "audius" ? "/api/v1/search/music" : "/api/v1/providers/jamendo/tracks";
      if (searchProvider === "audius") params.set("type", "tracks");
      const response = await fetch(`${API}${endpoint}?${params.toString()}`);
      const data = await response.json() as SearchResult;
      if (!response.ok) throw new Error(data.error || "Music search is unavailable.");
      const matches = searchProvider === "audius"
        ? (data.tracks ?? []).filter((item) => item.provider.toLowerCase() === "audius" && item.playable === true)
        : (data.items ?? []);
      setResults(matches);
      if (!matches.length) setNotice(t("No playable matches were found."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Music search is unavailable.");
    } finally {
      setSearching(false);
    }
  }

  async function addTrack(track: SearchTrack) {
    if (!token) return;
    setSavingId(track.id); setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/v1/playlists/${encodeURIComponent(playlistId)}/provider-tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify({ provider: track.provider.toLowerCase(), providerTrackId: track.providerTrackId ?? track.id.replace(/^audius:/, "") })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not add this track.");
      await loadPlaylist(token);
      setNotice("Track added to playlist.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this track.");
    } finally {
      setSavingId("");
    }
  }

  async function removeTrack(track: ProviderTrack) {
    if (!token) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`${API}/api/v1/playlists/${encodeURIComponent(playlistId)}/provider-tracks/${encodeURIComponent(track.provider)}/${encodeURIComponent(track.provider_track_id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` }, credentials: "include"
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not remove this track.");
      await loadPlaylist(token);
      setNotice("Track removed from playlist.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this track.");
    }
  }

  async function playSaved(track: ProviderTrack, queue: ProviderTrack[]) {
    setStartingId(track.provider + track.provider_track_id);
    setError("");
    try {
      const loadSavedTrack = async (item: ProviderTrack) => {
        const params = new URLSearchParams({ id: item.provider_track_id });
        const endpoint = item.provider === "audius" ? "/api/v1/providers/audius/tracks" : "/api/v1/providers/jamendo/tracks";
        const response = await fetch(`${API}${endpoint}?${params.toString()}`);
        const data = await response.json() as SearchResult;
        if (!response.ok || !data.items?.[0]) return null;
        return data.items[0];
      };
      const current = await loadSavedTrack(track);
      if (!current) throw new Error(t("This track is no longer available."));
      const queueTracks: PlayerTrack[] = [];
      for (const item of queue) {
        const loaded = await loadSavedTrack(item);
        if (loaded) queueTracks.push(loaded);
      }
      const startIndex = queueTracks.findIndex((item) => item.id === current.id);
      playTrack(current, startIndex >= 0 ? queueTracks.slice(startIndex) : [current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start playback.");
    } finally {
      setStartingId("");
    }
  }

  const saved = playlist?.provider_playlist_tracks ?? [];
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6 pb-40 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/playlists" className="btn-press inline-flex items-center gap-2 text-sm text-muted hover:text-white"><ArrowLeft size={17} /> {t("Back to playlists")}</Link>
      </header>
      {loading ? <div className="mt-8"><RowsSkeleton count={5} /></div> : !playlist ? (
        <div className="mt-8">
          <StateBlock
            icon={Disc3}
            tone="neutral"
            title={t("Playlist unavailable")}
            body={error || t("Sign in to open this playlist.")}
            actionHref="/auth"
            actionLabel={t("Sign in")}
          />
        </div>
      ) : (
        <>
          <section className="panel-hero mt-6 flex flex-wrap items-center gap-5 px-6 py-8 md:px-8">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-card bg-gradient-to-br from-accent/45 to-accent-teal/25 shadow-card md:h-32 md:w-32">
              <Disc3 size={40} className="text-white/85" strokeWidth={1.4} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="t-eyebrow">{t("Your playlist")}</p>
              <h1 className="t-display mt-1 break-words">{playlist.title}</h1>
              <p className="t-meta mt-2">{playlist.description || t("Your music, collected in one place.")}</p>
              <p className="t-meta mt-3">{saved.length} {t("tracks")} · {t("Licensed catalog tracks")}</p>
            </div>
          </section>

          <section className="surface mt-8 p-5 md:p-6" aria-labelledby="playlist-add-heading">
            <h2 id="playlist-add-heading" className="flex items-center gap-2 text-[15px] font-semibold"><Search size={17} className="text-violet-200" /> {t("Find tracks to add")}</h2>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setSearchProvider("jamendo"); setResults([]); }} aria-pressed={searchProvider === "jamendo"} className="btn-press chip">{t("Collections")}</button>
              <button type="button" onClick={() => { setSearchProvider("audius"); setResults([]); }} aria-pressed={searchProvider === "audius"} className="btn-press chip">{t("Creator uploads")}</button>
            </div>
            <form onSubmit={searchTracks} className="mt-4 flex gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} placeholder={t("Search by track or artist")} className="field min-w-0 flex-1" />
              <button disabled={searching || query.trim().length < 2} className="btn-press btn-primary !px-4 text-sm">{searching ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <Search size={16} />}<span className="hidden sm:inline">{t("Search")}</span></button>
            </form>
            {searching && <div className="mt-4"><RowsSkeleton count={3} /></div>}
            {!searching && results.length > 0 && <div className="mt-4 min-w-0 space-y-0.5">
              {results.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  onPlay={() => { /* results are previewable only after they join the playlist */ }}
                  disabled
                  meta={track.durationSeconds ? <>{track.artist} · {formatDuration(track.durationSeconds)}</> : track.artist}
                  trailing={
                    <button
                      type="button"
                      onClick={() => void addTrack(track)}
                      disabled={savingId === track.id || saved.some((item) => item.provider === track.provider.toLowerCase() && item.provider_track_id === (track.providerTrackId ?? track.id.replace(/^audius:/, "")))}
                      aria-label={t("Add track")}
                      className="btn-icon !text-violet-200 hover:bg-accent-soft"
                    >
                      {savingId === track.id ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200/40 border-t-violet-200" aria-hidden /> : <Plus size={16} />}
                    </button>
                  }
                />
              ))}
            </div>}
          </section>

          <section className="mt-8" aria-labelledby="playlist-tracks-heading">
            <h2 id="playlist-tracks-heading" className="t-h2">{t("Playlist tracks")}</h2>
            {saved.length === 0 ? (
              <div className="mt-4">
                <StateBlock
                  icon={Disc3}
                  tone="neutral"
                  title={t("No tracks yet")}
                  body={t("Search above and add your first track.")}
                />
              </div>
            ) : (
              <div className="mt-4 min-w-0 space-y-0.5">
                {saved.map((track, index) => (
                  <TrackRow
                    key={track.provider + track.provider_track_id}
                    leading={<span className="t-meta hidden w-6 shrink-0 text-right tabular-nums sm:block">{index + 1}</span>}
                    track={{
                      id: track.provider_track_id,
                      title: track.title,
                      artist: track.artist_name,
                      artworkUrl: track.artwork_url,
                      durationSeconds: track.duration_seconds
                    }}
                    isCurrent={currentTrack?.id === track.provider_track_id}
                    isPlaying={isPlaying}
                    busy={startingId === track.provider + track.provider_track_id}
                    meta={track.album_name ? <>{track.artist_name} · {track.album_name}</> : track.artist_name}
                    onPlay={() => void playSaved(track, saved)}
                    trailing={
                      <>
                        <a href={track.source_url} target="_blank" rel="noreferrer" aria-label={t("Open source")} className="btn-icon hidden sm:grid"><Link2 size={15} /></a>
                        <button type="button" onClick={() => void removeTrack(track)} aria-label={t("Remove track")} className="btn-icon hover:!text-rose-200"><Trash2 size={15} /></button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {notice && <p role="status" className="mt-5 rounded-card border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{t(notice) || notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-card border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}
