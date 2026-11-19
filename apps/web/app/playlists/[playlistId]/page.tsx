"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, AudioLines, ExternalLink, LoaderCircle, Music2, Play, Plus, Search, Trash2 } from "lucide-react";
import { useLanguage } from "../../../components/language-provider";
import { usePlayer, type PlayerTrack } from "../../../components/player-provider";

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
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function PlaylistDetailPage() {
  const params = useParams<{ playlistId: string }>();
  const playlistId = params.playlistId;
  const { t } = useLanguage();
  const { playTrack } = usePlayer();
  const [token, setToken] = useState("");
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [query, setQuery] = useState("");
  const [searchProvider, setSearchProvider] = useState<"jamendo" | "audius">("jamendo");
  const [results, setResults] = useState<SearchTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState("");
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
    fetch(`${API}/api/auth/refresh`, { method: "POST", credentials: "include" })
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
      if (!matches.length) setNotice(searchProvider === "audius" ? "No playable Audius matches were found." : "No licensed Jamendo matches were found.");
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
      if (!current) throw new Error("This track is no longer available.");
      const queueTracks: PlayerTrack[] = [];
      for (const item of queue) {
        const loaded = await loadSavedTrack(item);
        if (loaded) queueTracks.push(loaded);
      }
      const startIndex = queueTracks.findIndex((item) => item.id === current.id);
      playTrack(current, startIndex >= 0 ? queueTracks.slice(startIndex) : [current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start playback.");
    }
  }

  const saved = playlist?.provider_playlist_tracks ?? [];
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 pb-40 md:px-8">
      <header className="flex items-center justify-between">
        <Link href="/playlists" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={17}/> {t("Back to playlists")}</Link>
        <span className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><AudioLines className="text-violet-300"/> SONORA</span>
      </header>
      {loading ? <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> {t("Loading playlist…")}</div> : !playlist ? (
        <section className="mt-10 rounded-3xl border border-white/10 p-8"><h1 className="text-xl font-semibold">{t("Playlist unavailable")}</h1><p className="mt-2 text-sm text-slate-400">{error || t("Sign in to open this playlist.")}</p><Link href="/auth" className="mt-5 inline-flex rounded-full bg-violet-200 px-5 py-3 text-sm font-semibold text-[#171323]">{t("Sign in")}</Link></section>
      ) : (
        <>
          <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
            <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200">{t("Your playlist")}</p>
            <h1 className="mt-3 text-3xl font-semibold md:text-5xl">{playlist.title}</h1>
            <p className="mt-3 text-sm text-slate-300">{playlist.description || t("Your music, collected in one place.")}</p>
            <p className="mt-5 text-xs text-slate-500">{saved.length} {t("tracks")} · {t("Jamendo and Audius catalogs")}</p>
          </section>
          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.025] p-5 md:p-6">
            <h2 className="flex items-center gap-2 font-semibold"><Search size={17} className="text-violet-200"/> {t("Find tracks to add")}</h2>
            <div className="mt-4 flex gap-2"><button type="button" onClick={() => { setSearchProvider("jamendo"); setResults([]); }} aria-pressed={searchProvider === "jamendo"} className={searchProvider === "jamendo" ? "rounded-full bg-violet-200 px-4 py-2 text-xs text-[#171323]" : "rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"}>Jamendo</button><button type="button" onClick={() => { setSearchProvider("audius"); setResults([]); }} aria-pressed={searchProvider === "audius"} className={searchProvider === "audius" ? "rounded-full bg-violet-200 px-4 py-2 text-xs text-[#171323]" : "rounded-full border border-white/10 px-4 py-2 text-xs text-slate-300"}>Audius</button></div>
            <form onSubmit={searchTracks} className="mt-4 flex gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} placeholder={t("Search by track or artist")} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-violet-300/60"/>
              <button disabled={searching || query.trim().length < 2} className="inline-flex items-center gap-2 rounded-xl bg-violet-200 px-4 py-3 text-sm font-semibold text-[#171323] disabled:opacity-50">{searching ? <LoaderCircle className="animate-spin" size={16}/> : <Search size={16}/>} {t("Search")}</button>
            </form>
            {results.length > 0 && <div className="mt-4 divide-y divide-white/[0.06]">
              {results.map((track) => <div key={track.id} className="flex items-center gap-3 py-3">
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="h-11 w-11 rounded-lg object-cover"/> : <div className="grid h-11 w-11 place-items-center rounded-lg bg-violet-300/10"><Music2 size={18}/></div>}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-slate-500">{track.artist} · {track.provider}</p></div>
                <button type="button" onClick={() => void addTrack(track)} disabled={savingId === track.id || saved.some((item) => item.provider === track.provider.toLowerCase() && item.provider_track_id === (track.providerTrackId ?? track.id.replace(/^audius:/, "")))} className="rounded-lg border border-violet-200/20 p-2 text-violet-200 hover:bg-violet-200/10 disabled:opacity-40" aria-label={t("Add track")} >{savingId === track.id ? <LoaderCircle size={16} className="animate-spin"/> : <Plus size={16}/>}</button>
              </div>)}
            </div>}
          </section>
          <section className="mt-9">
            <h2 className="text-2xl font-semibold">{t("Playlist tracks")}</h2>
            {saved.length === 0 ? <div className="mt-4 rounded-3xl border border-dashed border-white/10 p-10 text-center"><Disc3Fallback/><p className="mt-3 font-medium">{t("No tracks yet")}</p><p className="mt-1 text-sm text-slate-500">{t("Search above and add your first track.")}</p></div> : (
              <div className="mt-4 space-y-2">
                {saved.map((track) => <article key={track.provider + track.provider_track_id} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
                  {track.artwork_url ? <img src={track.artwork_url} alt="" className="h-12 w-12 rounded-xl object-cover"/> : <div className="grid h-12 w-12 place-items-center rounded-xl bg-violet-300/10"><Music2 size={20}/></div>}
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{track.title}</p><p className="truncate text-xs text-slate-500">{track.artist_name} · {track.provider} · {track.duration_seconds ? timeLabel(track.duration_seconds) : ""}</p></div>
                  <a href={track.source_url} target="_blank" rel="noreferrer" aria-label={t("Open source")} className="rounded-lg p-2 text-slate-500 hover:text-white"><ExternalLink size={16}/></a>
                  <button type="button" onClick={() => void playSaved(track, saved)} aria-label={t("Play track")} className="rounded-lg p-2 text-violet-200 hover:bg-violet-200/10"><Play size={17} fill="currentColor"/></button>
                  <button type="button" onClick={() => void removeTrack(track)} aria-label={t("Remove track")} className="rounded-lg p-2 text-slate-500 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={16}/></button>
                </article>)}
              </div>
            )}
          </section>
        </>
      )}
      {notice && <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-xs text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-xs text-rose-200">{error}</p>}
    </main>
  );
}

function Disc3Fallback() {
  return <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-300/10 text-violet-200"><Music2 size={24}/></div>;
}
