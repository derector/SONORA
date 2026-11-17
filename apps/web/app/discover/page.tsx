"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, AudioLines, ExternalLink, Heart, LoaderCircle, Music2, Play, Pause, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePlayer } from "../../components/player-provider";
import { useLanguage } from "../../components/language-provider";

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number;
  artworkUrl: string | null;
  audioUrl: string;
  licenseUrl: string;
  sourceUrl: string;
  provider: string;
};

type Result = { items?: Track[]; error?: string };

const API = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function DiscoverPage() {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [savingFavorite, setSavingFavorite] = useState<string>("");
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();

  async function loadTracks(search = "") {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`${API}/api/v1/providers/jamendo/tracks?${params.toString()}`);
      const result = await response.json() as Result;
      if (!response.ok) throw new Error(result.error || "The catalog could not be loaded.");
      setTracks(result.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The catalog could not be loaded.");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTracks();
    fetch(`${API}/api/v1/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<{ session?: { access_token?: string } }> : null)
      .then(async (result) => {
        const accessToken = result?.session?.access_token;
        if (!accessToken) return;
        setToken(accessToken);
        const response = await fetch(`${API}/api/v1/provider-favorites`, {
          headers: { Authorization: `Bearer ${accessToken}` }, credentials: "include"
        });
        if (response.ok) {
          const saved = await response.json() as { items?: Array<{ provider_track_id: string }> };
          setFavoriteIds((saved.items ?? []).map((item) => item.provider_track_id));
        }
      })
      .catch(() => undefined);
  }, []);

  async function toggleFavorite(track: Track) {
    if (!token) {
      setError("Sign in to save tracks to your library.");
      return;
    }
    setSavingFavorite(track.id);
    setError("");
    try {
      const isSaved = favoriteIds.includes(track.id);
      const response = await fetch(`${API}/api/v1/provider-favorites${isSaved ? `/${encodeURIComponent(track.id)}` : ""}`, {
        method: isSaved ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        ...(isSaved ? {} : { body: JSON.stringify({ providerTrackId: track.id }) })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update favorites.");
      setFavoriteIds((ids) => isSaved ? ids.filter((id) => id !== track.id) : [...ids, track.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update favorites.");
    } finally {
      setSavingFavorite("");
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadTracks(query);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1440px] px-4 py-6 pb-36 md:px-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4"><Link href="/" className="inline-flex items-center gap-3 text-sm text-slate-400 transition hover:text-white"><ArrowLeft size={17}/> Back to SONORA</Link><Link href="/history" className="text-sm text-slate-400 hover:text-white">History</Link></div>
        <div className="flex items-center gap-2 text-sm font-semibold tracking-[.2em]"><AudioLines className="text-violet-300"/> SONORA</div>
      </header>

      <section className="mt-10 rounded-[2rem] border border-violet-300/15 bg-gradient-to-br from-[#292044] via-[#171426] to-[#10131c] p-7 md:p-10">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.25em] text-violet-200"><Music2 size={14}/> Discover independent music</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-5xl">Find your next frequency.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Explore independent tracks from Jamendo. Every result carries its creator, source and Creative Commons license details. Playback is offered only where the track and provider terms permit it.</p>
        <form onSubmit={submitSearch} className="mt-7 flex max-w-2xl gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
          <Search className="ml-2 mt-2.5 shrink-0 text-slate-400" size={18}/>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks, artists or moods" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-500"/>
          <button disabled={loading} className="rounded-xl bg-violet-200 px-5 py-2 text-sm font-semibold text-[#171323] transition hover:bg-white disabled:opacity-50">Search</button>
        </form>
      </section>

      <div className="mt-9 flex items-end justify-between gap-4">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-300">Open catalog</p><h2 className="mt-2 text-2xl font-semibold">Tracks to explore</h2></div>
        <span className="text-xs text-slate-500">Powered by Jamendo</span>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={18}/> Loading the catalog…</div>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-amber-300/15 bg-amber-300/5 p-6">
          <p className="font-medium text-amber-100">Catalog connection is not ready.</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{error}</p>
          <p className="mt-3 text-xs text-slate-500">The provider API key must be configured server-side. No demo tracks are substituted.</p>
        </div>
      ) : tracks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-slate-400">No tracks found. Try another search.</div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tracks.map((track) => (
            <article key={track.id} className="overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="flex gap-4">
                {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" loading="lazy"/> : <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/30 to-sky-500/20"><Music2 className="text-violet-100" size={28}/></div>}
                <div className="min-w-0 flex-1 py-1">
                  <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 truncate font-medium">{track.title}</h3><button type="button" onClick={() => void toggleFavorite(track)} disabled={savingFavorite === track.id} aria-label={favoriteIds.includes(track.id) ? "Remove from favorites" : "Add to favorites"} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:opacity-40"><Heart size={16} fill={favoriteIds.includes(track.id) ? "currentColor" : "none"}/></button></div>
                  <p className="mt-1 truncate text-sm text-slate-400">{track.artist}</p>
                  <p className="mt-2 text-xs text-slate-500">{track.album || "Independent release"} · {duration(track.durationSeconds)}</p>
                </div>
              </div>
              <button type="button" onClick={() => currentTrack?.id === track.id ? togglePlay() : playTrack(track, tracks)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200/20 bg-violet-200/10 px-4 py-3 text-sm font-medium text-violet-100 transition hover:bg-violet-200/20" aria-label={`${currentTrack?.id === track.id && isPlaying ? "Pause" : "Play"} ${track.title}`}>{currentTrack?.id === track.id && isPlaying ? <Pause size={16}/> : <Play size={16} fill="currentColor"/>}{currentTrack?.id === track.id && isPlaying ? "Pause" : "Play track"}</button>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[11px]">
                <span className="inline-flex items-center gap-1 text-emerald-200"><ShieldCheck size={13}/> CC license</span>
                <div className="flex items-center gap-3 text-slate-400">
                  <a href={track.licenseUrl} target="_blank" rel="noreferrer" className="hover:text-white">License</a>
                  <a href={track.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">Jamendo <ExternalLink size={11}/></a>
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-slate-600">Artist: {track.artist} · Source: Jamendo · License terms apply.</p>
            </article>
          ))}
        </div>
      )}

      <footer className="mt-14 border-t border-white/[0.07] py-6 text-xs text-slate-600">SONORA · Independent music discovery · Rights and attribution stay attached to every track</footer>
    </main>
  );
}
